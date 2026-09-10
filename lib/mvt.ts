/**
 * Minimal Mapbox Vector Tile reader.
 *
 * We only need geometry out of OS's tiles in order to write CAD files, and
 * every published MVT library brings a protobuf runtime with it. The format's
 * geometry encoding is small enough to read directly, so this stays dependency
 * free and does exactly what the exporter needs and nothing else.
 */

export type Ring = Array<[number, number]>;
export type MvtFeature = { type: number; parts: Ring[] };
export type MvtLayer = { name: string; extent: number; features: MvtFeature[] };

function varint(b: Uint8Array, i: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = b[i++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result >>> 0, i];
    shift += 7;
  }
}

type Field = { num: number; wire: number; bytes?: Uint8Array; value?: number };

function* fields(b: Uint8Array, start: number, end: number): Generator<Field> {
  let i = start;
  while (i < end) {
    let key: number;
    [key, i] = varint(b, i);
    const num = key >> 3;
    const wire = key & 7;

    if (wire === 0) {
      let value: number;
      [value, i] = varint(b, i);
      yield { num, wire, value };
    } else if (wire === 2) {
      let len: number;
      [len, i] = varint(b, i);
      yield { num, wire, bytes: b.subarray(i, i + len) };
      i += len;
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
}

function packed(b: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < b.length) {
    let v: number;
    [v, i] = varint(b, i);
    out.push(v);
  }
  return out;
}

/** MVT geometry commands: MoveTo starts a part, LineTo extends, ClosePath shuts it. */
function decodeGeometry(nums: number[]): Ring[] {
  const parts: Ring[] = [];
  let cur: Ring = [];
  let x = 0;
  let y = 0;
  let i = 0;

  while (i < nums.length) {
    const cmd = nums[i++];
    const id = cmd & 7;
    const count = cmd >> 3;

    if (id === 1 || id === 2) {
      for (let n = 0; n < count; n++) {
        const dx = nums[i++];
        const dy = nums[i++];
        // Zig-zag decode, then accumulate — MVT stores deltas.
        x += (dx >> 1) ^ -(dx & 1);
        y += (dy >> 1) ^ -(dy & 1);
        if (id === 1) {
          if (cur.length) parts.push(cur);
          cur = [[x, y]];
        } else {
          cur.push([x, y]);
        }
      }
    } else if (id === 7) {
      if (cur.length) {
        cur.push(cur[0]);
        parts.push(cur);
        cur = [];
      }
    }
  }

  if (cur.length) parts.push(cur);
  return parts;
}

export function decodeTile(buf: ArrayBuffer): MvtLayer[] {
  const b = new Uint8Array(buf);
  const layers: MvtLayer[] = [];

  for (const f of fields(b, 0, b.length)) {
    if (f.num !== 3 || !f.bytes) continue;

    let name = "";
    let extent = 4096;
    const features: MvtFeature[] = [];

    for (const lf of fields(f.bytes, 0, f.bytes.length)) {
      if (lf.num === 1 && lf.bytes) {
        name = new TextDecoder().decode(lf.bytes);
      } else if (lf.num === 5 && lf.value !== undefined) {
        extent = lf.value;
      } else if (lf.num === 2 && lf.bytes) {
        let type = 0;
        let geom: number[] | null = null;
        for (const ff of fields(lf.bytes, 0, lf.bytes.length)) {
          if (ff.num === 3 && ff.value !== undefined) type = ff.value;
          else if (ff.num === 4 && ff.bytes) geom = packed(ff.bytes);
        }
        if (geom) features.push({ type, parts: decodeGeometry(geom) });
      }
    }

    layers.push({ name, extent, features });
  }

  return layers;
}
