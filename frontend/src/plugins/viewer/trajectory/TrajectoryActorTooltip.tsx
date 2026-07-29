/**
 * Trajectory actor info tooltip.
 *
 * A semi-transparent floating card that appears when the user clicks an actor
 * during trajectory playback. It tracks the actor on screen (via
 * `renderer.projectWorldToScreen`) and live-updates the actor's per-frame state
 * (position, heading, speed, dimensions, time) as playback advances.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useTrajectoryStore } from '../../../stores/trajectoryStore';
import { getEntityInfoAt, type TrajActorInfo } from '../../../plugins/npc-actors';
import { getViewportRenderer } from '../../../viewport/viewportRef';
import { getTrajectorySceneOrigin } from '../../../viewport/trajectoryPlayback';
import './TrajectoryActorTooltip.css';

interface ScreenPos {
  left: number;
  top: number;
}

/** Format a number to 2 decimals for the readout. */
function fmt(n: number): string {
  return n.toFixed(2);
}

/** True when two samples render identically at 2-decimal precision. */
function sameInfo(a: TrajActorInfo, b: TrajActorInfo): boolean {
  return (
    a.id === b.id &&
    a.ego === b.ego &&
    fmt(a.x) === fmt(b.x) &&
    fmt(a.y) === fmt(b.y) &&
    fmt(a.z) === fmt(b.z) &&
    fmt(a.yaw) === fmt(b.yaw) &&
    fmt(a.speed) === fmt(b.speed) &&
    fmt(a.length) === fmt(b.length) &&
    fmt(a.width) === fmt(b.width) &&
    fmt(a.height) === fmt(b.height) &&
    fmt(a.time) === fmt(b.time)
  );
}

export function TrajectoryActorTooltip() {
  const { t } = useTranslation();
  const selectedEntityId = useTrajectoryStore((s) => s.selectedEntityId);
  const setSelectedEntity = useTrajectoryStore((s) => s.setSelectedEntity);
  const [info, setInfo] = useState<TrajActorInfo | null>(null);
  const [pos, setPos] = useState<ScreenPos | null>(null);
  const rafRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Last emitted values, to avoid re-rendering when nothing changed (e.g. paused
  // with a static camera) — the churn otherwise competes with the render loop.
  const lastInfoRef = useRef<TrajActorInfo | null>(null);
  const lastPosRef = useRef<ScreenPos | null>(null);

  // While an actor is selected, run a lightweight RAF loop that resamples its
  // state and reprojects its screen position (in every camera mode), emitting
  // new React state only when a rounded value actually changed.
  useEffect(() => {
    if (!selectedEntityId) {
      lastInfoRef.current = null;
      lastPosRef.current = null;
      setInfo(null);
      setPos(null);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(tick);
      const state = useTrajectoryStore.getState();
      const data = state.data;
      if (!data) {
        if (lastInfoRef.current) {
          lastInfoRef.current = null;
          lastPosRef.current = null;
          setInfo(null);
          setPos(null);
        }
        return;
      }
      const next = getEntityInfoAt(data, selectedEntityId, state.currentTime);
      if (next && (!lastInfoRef.current || !sameInfo(lastInfoRef.current, next))) {
        lastInfoRef.current = next;
        setInfo(next);
      }

      if (!canvasRef.current) {
        canvasRef.current = document.querySelector('canvas.viewport-canvas');
      }
      const renderer = getViewportRenderer();
      const canvas = canvasRef.current;
      if (next && renderer && canvas) {
        const origin = getTrajectorySceneOrigin();
        // projectWorldToScreen returns device pixels relative to the canvas;
        // convert to client CSS coordinates for the fixed-positioned card.
        // Anchor at the actor's box-center height (not the ground) so the card
        // tracks the visible vehicle at any zoom/tilt.
        const screen = renderer.projectWorldToScreen(
          next.x - origin[0],
          next.y - origin[1],
          next.z - origin[2] + next.height / 2,
        );
        if (screen) {
          const rect = canvas.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const nextPos: ScreenPos = {
            left: Math.round(rect.left + screen.x / dpr),
            top: Math.round(rect.top + screen.y / dpr),
          };
          const prev = lastPosRef.current;
          if (!prev || prev.left !== nextPos.left || prev.top !== nextPos.top) {
            lastPosRef.current = nextPos;
            setPos(nextPos);
          }
        } else if (lastPosRef.current) {
          lastPosRef.current = null;
          setPos(null);
        }
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [selectedEntityId]);

  if (!selectedEntityId || !info || !pos) return null;

  return (
    <div
      className="traj-actor-tooltip"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label={t('trajectory.actor.title')}
    >
      <div className="traj-actor-tooltip-head">
        <span className={`traj-actor-badge ${info.ego ? 'ego' : 'opp'}`}>
          {info.ego ? t('trajectory.actor.ego') : t('trajectory.actor.opponent')}
        </span>
        <span className="traj-actor-id" title={info.id}>{info.id}</span>
        <button
          type="button"
          className="traj-actor-close"
          onClick={() => setSelectedEntity(null)}
          aria-label={t('trajectory.actor.close')}
          title={t('trajectory.actor.close')}
        >
          <X size={12} />
        </button>
      </div>
      <dl className="traj-actor-tooltip-body">
        <div>
          <dt>{t('trajectory.actor.position')}</dt>
          <dd>{fmt(info.x)}, {fmt(info.y)}, {fmt(info.z)}</dd>
        </div>
        <div>
          <dt>{t('trajectory.actor.heading')}</dt>
          <dd>{fmt(info.yaw)}°</dd>
        </div>
        <div>
          <dt>{t('trajectory.actor.speed')}</dt>
          <dd>{fmt(info.speed)} m/s</dd>
        </div>
        <div>
          <dt>{t('trajectory.actor.size')}</dt>
          <dd>{fmt(info.length)} × {fmt(info.width)} × {fmt(info.height)} m</dd>
        </div>
        <div>
          <dt>{t('trajectory.actor.time')}</dt>
          <dd>{fmt(info.time)} s</dd>
        </div>
      </dl>
    </div>
  );
}
