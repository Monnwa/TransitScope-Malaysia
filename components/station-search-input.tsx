"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SearchEntity, StationSearchRequest } from "@/lib/station-search";

const labels = {
  RAIL_STATION: "Rail station",
  BUS_STOP: "Bus stop",
  MICROMOBILITY_STATION: "Micromobility",
} as const;

export default function StationSearchInput({ query, results, request, loading, limited, onChange, onSelect }: {
  query: string;
  results: SearchEntity[];
  request: StationSearchRequest | null;
  loading: boolean;
  limited: boolean;
  onChange: (query: string) => void;
  onSelect: (entity: SearchEntity) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [openAt, setOpenAt] = useState<{ revision?: number } | null>(null);
  const [active, setActive] = useState(-1);
  const revision = request?.revision;
  const visible = !!openAt && openAt.revision === revision && query.trim().length > 0;
  const optionId = (index: number) => `${id}-option-${index}`;
  const open = () => setOpenAt({ revision });
  const close = () => { setOpenAt(null); setActive(-1); };
  useEffect(() => {
    if (revision === undefined) return;
    setOpenAt(null);
    setActive(-1);
  }, [revision]);
  useEffect(() => {
    if (active >= 0) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(entity: SearchEntity) {
    close();
    input.current?.blur();
    onSelect(entity);
  }

  return <div className="station-search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      close();
    }
  }}>
    <label className="search"><span>Search vehicles, routes or stations</span>
      <input ref={input} value={query} autoComplete="off" placeholder="e.g. bus number or station"
        aria-autocomplete="list" aria-controls={visible && results.length ? id : undefined}
        aria-activedescendant={visible && results[active] ? optionId(active) : undefined}
        onFocus={open} onClick={open}
        onChange={event => { onChange(event.target.value); setOpenAt({}); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === "Escape" && visible) {
            event.preventDefault();
            close();
          } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
            event.preventDefault();
            open();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive(current => current < 0 ? (step === 1 ? 0 : results.length - 1) :
              (current + step + results.length) % results.length);
          } else if (event.key === "Enter" && visible && results.length) {
            event.preventDefault();
            choose(results[active] ?? results[0]);
          }
        }}/>
    </label>
    {query && <button className="station-search-clear" type="button" aria-label="Clear station search" onClick={() => {
      onChange("");
      setActive(-1);
      input.current?.focus({ preventScroll: true });
    }}>×</button>}
    {visible && <div className="station-search-results">
      {results.length ? <div ref={list} id={id} role="listbox" aria-label="Station search results">
        {results.map((entity, index) => <button key={`${entity.type}:${entity.id}`} type="button"
          id={optionId(index)} role="option" tabIndex={-1} aria-selected={index === active} data-type={entity.type}
          onMouseDown={event => event.preventDefault()} onClick={event => {
            event.stopPropagation();
            choose(entity);
          }}>
          <strong>{entity.name}</strong>
          <small><b>{labels[entity.type]}</b> · {entity.type === "BUS_STOP" ?
            [entity.stop.feed, `Stop ID ${entity.stop.sourceId}`, entity.area].filter(Boolean).join(" · ") :
            [entity.operator, entity.area, entity.state].filter(Boolean).join(" · ")}</small>
          {entity.routes.length > 0 && <small>{entity.routes.map(route => route.name).join(" · ")}</small>}
        </button>)}
      </div> : <p role="status">{loading ? "Loading bus stops…" : "No matching stations or stops."}</p>}
      {limited && <p role="status">Some static bus stops are unavailable.</p>}
    </div>}
  </div>;
}
