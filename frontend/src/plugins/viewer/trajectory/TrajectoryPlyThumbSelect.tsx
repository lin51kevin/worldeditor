/**
 * Thumbnail-aware PLY selector.
 *
 * A lightweight custom dropdown (a native `<select>` cannot render images) that
 * shows each candidate's thumbnail beside its name, plus a "none" option. Used
 * for the ego / opponent model rows where a visual preview aids selection.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ImageOff, Check } from 'lucide-react';
import type { PlyCandidate } from '../../../stores/trajectoryConfigStore';

function keyName(key: string): string {
  const norm = key.replace(/\\/g, '/');
  const slash = norm.lastIndexOf('/');
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

interface Props {
  value: string | null;
  candidates: PlyCandidate[];
  onChange: (key: string | null) => void;
  ariaLabel: string;
  noneLabel: string;
}

export function TrajectoryPlyThumbSelect({ value, candidates, onChange, ariaLabel, noneLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ src: string; top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Hide any hover preview once the menu closes.
  useEffect(() => {
    if (!open) setPreview(null);
  }, [open]);

  const selected = candidates.find((c) => c.key === value) ?? null;
  const label = selected ? selected.name : value !== null ? keyName(value) : noneLabel;

  const pick = useCallback(
    (key: string | null) => {
      onChange(key);
      setOpen(false);
    },
    [onChange],
  );

  /** Show an enlarged preview anchored to the hovered row's right edge. */
  const showPreview = useCallback((e: React.MouseEvent, thumbnail: string | undefined) => {
    if (!thumbnail) {
      setPreview(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPreview({ src: thumbnail, top: rect.top, left: rect.right + 8 });
  }, []);

  return (
    <div className="traj-cfg-thumb-select" ref={rootRef}>
      <button
        type="button"
        className="traj-cfg-thumb-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected?.thumbnail ? (
          <img className="traj-cfg-thumb" src={selected.thumbnail} alt="" />
        ) : (
          <span className="traj-cfg-thumb traj-cfg-thumb-empty"><ImageOff size={12} /></span>
        )}
        <span className="traj-cfg-thumb-label">{label}</span>
        <ChevronDown size={14} className="traj-cfg-thumb-caret" />
      </button>
      {open && (
        <ul className="traj-cfg-thumb-menu" role="listbox">
          <li>
            <button type="button" className="traj-cfg-thumb-item" onClick={() => pick(null)}>
              <span className="traj-cfg-thumb traj-cfg-thumb-empty"><ImageOff size={12} /></span>
              <span className="traj-cfg-thumb-label">{noneLabel}</span>
              {value === null && <Check size={13} className="traj-cfg-thumb-check" />}
            </button>
          </li>
          {candidates.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                className="traj-cfg-thumb-item"
                onClick={() => pick(c.key)}
                onMouseEnter={(e) => showPreview(e, c.thumbnail)}
                onMouseLeave={() => setPreview(null)}
              >
                {c.thumbnail ? (
                  <img className="traj-cfg-thumb" src={c.thumbnail} alt="" />
                ) : (
                  <span className="traj-cfg-thumb traj-cfg-thumb-empty"><ImageOff size={12} /></span>
                )}
                <span className="traj-cfg-thumb-label">{c.name}</span>
                {c.key === value && <Check size={13} className="traj-cfg-thumb-check" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview &&
        createPortal(
          <img
            className="traj-cfg-thumb-preview"
            src={preview.src}
            alt=""
            style={{ top: preview.top, left: preview.left }}
          />,
          document.body,
        )}
    </div>
  );
}
