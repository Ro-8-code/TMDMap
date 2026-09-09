"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import { Brand } from "../brand";
import { gridRef } from "@/lib/osgb";
import { captureFilename, captureMap, metresPerPixel, zoomForScale } from "@/lib/capture";

type Hit = {
  id: string;
  label: string;
  sub: string;
  lat: number;
  lon: number;
  zoom: number;
  source: "postcode" | "osm";
};

type LayerId = "leisure" | "outdoor" | "road" | "light" | "osm";

const LAYERS: {
  id: LayerId;
  name: string;
  note: string;
  tiles: string[];
  maxzoom: number;
  attribution: string;
}[] = [
  {
    id: "leisure",
    name: "OS Leisure",
    note: "1:25k / 1:50k paper style",
    tiles: ["/api/tiles/Leisure_3857/{z}/{x}/{y}"],
    maxzoom: 16,
    attribution: "Contains OS data © Crown copyright and database right",
  },
  {
    id: "outdoor",
    name: "OS Outdoor",
    note: "Detailed, paths & contours",
    tiles: ["/api/tiles/Outdoor_3857/{z}/{x}/{y}"],
    maxzoom: 20,
    attribution: "Contains OS data © Crown copyright and database right",
  },
  {
    id: "road",
    name: "OS Road",
    note: "Highway network emphasis",
    tiles: ["/api/tiles/Road_3857/{z}/{x}/{y}"],
    maxzoom: 20,
    attribution: "Contains OS data © Crown copyright and database right",
  },
  {
    id: "light",
    name: "OS Light",
    note: "Minimal, clean backdrop",
    tiles: ["/api/tiles/Light_3857/{z}/{x}/{y}"],
    maxzoom: 20,
    attribution: "Contains OS data © Crown copyright and database right",
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    note: "Fallback — no OS key needed",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
    maxzoom: 19,
    attribution: "© OpenStreetMap contributors",
  },
];

// Standard UK drawing-office scales. Picking one sets the zoom so the map
// draws at that scale on a 96 DPI display.
const SCALES = [200, 500, 1250, 2500] as const;

function styleFor(layerId: LayerId) {
  const layer = LAYERS.find((l) => l.id === layerId) ?? LAYERS[0];
  return {
    version: 8 as const,
    sources: {
      base: {
        type: "raster" as const,
        tiles: layer.tiles,
        tileSize: 256,
        maxzoom: layer.maxzoom,
        attribution: layer.attribution,
      },
    },
    layers: [
      { id: "bg", type: "background" as const, paint: { "background-color": "#1c2024" } },
      { id: "base", type: "raster" as const, source: "base" },
    ],
  };
}

export default function MapView({ osConfigured }: { osConfigured: boolean }) {
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Default to OS Leisure, unless there's no OS key — then OSM, so the map
  // is never a blank grey rectangle on a fresh deploy.
  const [layerId, setLayerId] = useState<LayerId>(osConfigured ? "leisure" : "osm");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [readout, setReadout] = useState({ lat: 54.5, lon: -3.2, zoom: 6 });
  const [label, setLabel] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /* ------------------------------- the map ------------------------------- */

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(osConfigured ? "leisure" : "osm"),
      center: [-3.2, 54.5], // roughly centred on Great Britain
      zoom: 5.4,
      maxZoom: 20,
      attributionControl: false,
      // Required so the drawing buffer can still be read when we export.
      preserveDrawingBuffer: true,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 140, unit: "metric" }),
      "bottom-right"
    );

    const sync = () => {
      const c = map.getCenter();
      setReadout({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
    };
    map.on("move", sync);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [osConfigured]);

  // Swapping basemap: replace the style but hold the current view, so
  // switching layers never loses the location you searched for.
  const initialLayer = useRef(layerId);
  useEffect(() => {
    const map = mapRef.current;
    // The map is created with the right style already; re-setting it on mount
    // races the initial style load and leaves the canvas blank.
    if (!map || layerId === initialLayer.current) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    map.setStyle(styleFor(layerId));
    map.once("styledata", () => {
      map.jumpTo({ center, zoom });
    });
  }, [layerId]);

  /* ------------------------------- search -------------------------------- */

  // Set when the query box is filled in by picking a result, so choosing a
  // place doesn't immediately re-run the search and re-open the dropdown.
  const suppressSearch = useRef(false);

  useEffect(() => {
    if (suppressSearch.current) {
      suppressSearch.current = false;
      return;
    }
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const body = await r.json();
        setHits(body.results ?? []);
        setActive(0);
        setOpen(true);
      } catch {
        /* aborted or offline — leave the previous results in place */
      } finally {
        setSearching(false);
      }
    }, 280);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const goTo = useCallback((hit: Hit) => {
    const map = mapRef.current;
    if (!map) return;

    setOpen(false);
    suppressSearch.current = true;
    setQuery(hit.label);
    setLabel(hit.sub ? `${hit.label} — ${hit.sub.split(", ").slice(0, 2).join(", ")}` : hit.label);
    inputRef.current?.blur();

    map.flyTo({ center: [hit.lon, hit.lat], zoom: hit.zoom, duration: 1400 });

    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: "#ffb400" })
      .setLngLat([hit.lon, hit.lat])
      .addTo(map);
  }, []);

  const applyScale = useCallback((scale: number) => {
    const map = mapRef.current;
    if (!map) return;
    const z = zoomForScale(scale, map.getCenter().lat);
    map.easeTo({ zoom: Math.min(z, map.getMaxZoom()), duration: 500 });
  }, []);

  const onCapture = useCallback(async () => {
    const map = mapRef.current;
    if (!map || capturing) return;

    setCapturing(true);
    setNote(null);
    try {
      const blob = await captureMap(map, label || query);
      const c = map.getCenter();
      const name = captureFilename(label || query, c.lat, c.lng);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);

      setNote(`Saved ${name}`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setCapturing(false);
    }
  }, [capturing, label, query]);

  // Clear the toast after a few seconds so it doesn't sit over the map.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) {
      if (e.key === "Escape") inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      goTo(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Close the dropdown on an outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const currentLayer = LAYERS.find((l) => l.id === layerId)!;

  /* -------------------------------- render ------------------------------- */

  return (
    <div className="map-shell">
      <header className="topbar">
        <Brand />

        <div className="searchbox" ref={boxRef}>
          <span className="search-icon" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => hits.length > 0 && setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search an address, street or postcode…"
            aria-label="Search for a location"
            autoComplete="off"
          />

          {open && (
            <div className="results" role="listbox">
              {hits.length === 0 ? (
                <div className="result-empty">
                  {searching ? "Searching…" : "No matches found."}
                </div>
              ) : (
                hits.map((hit, i) => (
                  <button
                    key={hit.id}
                    className="result"
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => goTo(hit)}
                    type="button"
                  >
                    <div className="result-main">
                      {hit.label}
                      {hit.source === "postcode" && (
                        <span className="result-tag">Postcode</span>
                      )}
                    </div>
                    {hit.sub && <div className="result-sub">{hit.sub}</div>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="spacer" />

        <button
          className="linkbtn linkbtn-primary"
          type="button"
          onClick={onCapture}
          disabled={capturing}
          title="Download a PNG of this view, with scale bar and grid reference burned in"
        >
          {capturing ? "Exporting…" : "Export PNG"}
        </button>

        <form action="/auth/signout" method="post">
          <button className="linkbtn" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <div className="map-area">
        <div id="map" ref={containerRef} />

        <div className="side-panel">
        <div className="layers">
          <div className="layers-title">Basemap</div>
          {LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className="layer-btn"
              data-active={l.id === layerId}
              onClick={() => setLayerId(l.id)}
              disabled={l.id !== "osm" && !osConfigured}
              title={!osConfigured && l.id !== "osm" ? "Add OS_API_KEY to enable" : l.note}
            >
              {l.name}
              <small>{l.note}</small>
            </button>
          ))}
        </div>

        <div className="scales">
          <div className="layers-title">Scale</div>
          <div className="scale-row">
            {SCALES.map((sc) => (
              <button
                key={sc}
                type="button"
                className="scale-btn"
                data-active={Math.abs(readout.zoom - zoomForScale(sc, readout.lat)) < 0.05}
                onClick={() => applyScale(sc)}
              >
                1:{sc}
              </button>
            ))}
          </div>
        </div>
        </div>

        {note && <div className="toast">{note}</div>}

        {!osConfigured && (
          <div className="banner msg msg-warn">
            No OS Data Hub key set — showing OpenStreetMap. Add{" "}
            <code>OS_API_KEY</code> to switch on Ordnance Survey mapping.
          </div>
        )}

        <div className="readout">
          <div className="chip">
            <b>Lat</b> {readout.lat.toFixed(5)} &nbsp; <b>Lon</b>{" "}
            {readout.lon.toFixed(5)}
          </div>
          <div className="chip">
            <b>NGR</b> {gridRef(readout.lat, readout.lon, 5) ?? "outside GB"}
          </div>
          <div className="chip">
            <b>Scale</b> 1:
            {Math.round(metresPerPixel(readout.lat, readout.zoom) / (0.0254 / 96))}
          </div>
        </div>

        <div className="attrib">{currentLayer.attribution}</div>
      </div>
    </div>
  );
}
