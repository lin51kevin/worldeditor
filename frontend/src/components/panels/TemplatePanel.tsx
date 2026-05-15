import { useState, useMemo, useCallback } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePluginContribStore } from '../../stores/pluginContribStore';
import { useEditorViewStore } from '../../stores/editorViewStore';
import type { TemplateItemDef } from '../../stores/pluginContribStore';
import './TemplatePanel.css';

const FAVORITES_KEY = 'we_template_favorites';
const FAVORITES_TAB_ID = '__favorites__';

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // ignore parse errors
  }
  return [];
}

function saveFavorites(ids: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage errors
  }
}

export function TemplatePanel() {
  const { t } = useTranslation();
  const templateSections = usePluginContribStore((s) => s.templateSections);

  const sorted = useMemo(
    () => [...templateSections].sort((a, b) => a.order - b.order),
    [templateSections],
  );

  // Flat list of all items across all sections
  const allItems = useMemo(
    () => sorted.flatMap((s) => s.items),
    [sorted],
  );

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);

  // Resolve active section; defaults to favorites tab if has favorites, else first real section
  const resolvedId: string | null = (() => {
    if (activeSectionId === FAVORITES_TAB_ID) return FAVORITES_TAB_ID;
    if (sorted.some((s) => s.id === activeSectionId)) return activeSectionId;
    if (favorites.length > 0) return FAVORITES_TAB_ID;
    return sorted[0]?.id ?? null;
  })();

  const isFavoritesActive = resolvedId === FAVORITES_TAB_ID;
  const activeSection = sorted.find((s) => s.id === resolvedId) ?? null;
  const selectedTemplateId = useEditorViewStore((s) => s.splineTemplateId);
  const pendingTemplateId = useEditorViewStore((s) => s.pendingTemplateId);
  const editMode = useEditorViewStore((s) => s.editMode);

  const favoriteItems = useMemo(
    () => allItems.filter((item) => favorites.includes(item.id)),
    [allItems, favorites],
  );

  const displayedItems: TemplateItemDef[] = isFavoritesActive
    ? favoriteItems
    : (activeSection?.items ?? []);

  const toggleFavorite = useCallback((itemId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId];
      saveFavorites(next);
      return next;
    });
  }, []);

  const findItem = useCallback(
    (itemId: string): TemplateItemDef | undefined => allItems.find((i) => i.id === itemId),
    [allItems],
  );

  const findItemSectionId = useCallback(
    (itemId: string): string | undefined =>
      sorted.find((s) => s.items.some((i) => i.id === itemId))?.id,
    [sorted],
  );

  const handleItemClick = (itemId: string) => {
    const item = isFavoritesActive ? findItem(itemId) : activeSection?.items.find((i) => i.id === itemId);
    if (!item) return;
    const viewStore = useEditorViewStore.getState();
    viewStore.setSplineTemplateId(itemId);
    if (itemId.startsWith('tpl:road:')) {
      // Road cross-section templates: enter draw mode.
      // Respect whichever draw mode is currently active in the toolbar;
      // default to 'spline' (Hermite cubic spline) if none is active.
      viewStore.clearPendingTemplate();
      const current = viewStore.editMode;
      const inDrawMode =
        current === 'spline';
      if (!inDrawMode) {
        viewStore.setEditMode('spline');
      } else {
        // Already in a draw mode — start fresh with new template, keep same mode
        viewStore.clearSplineKnots();
      }
    } else if (itemId.startsWith('tpl:jct:')) {
      // Junction templates: enter click-to-place mode.
      // The next single left-click in the viewport will instantiate the template.
      viewStore.setPendingTemplate(itemId);
    } else {
      // Signal / marking templates apply to the currently selected road immediately.
      viewStore.clearPendingTemplate();
      item.onApply?.();
    }
  };

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    const sectionId = isFavoritesActive ? (findItemSectionId(itemId) ?? '') : (resolvedId ?? '');
    e.dataTransfer.setData('application/we-template-id', itemId);
    e.dataTransfer.setData('application/we-template-section', sectionId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="template-panel">
      <div className="template-header">
        <span>{t('templatePanel.header')}</span>
      </div>

      {sorted.length > 0 && (
        <div className="template-tabs" role="tablist">
          {/* Favorites tab — always first */}
          <button
            key={FAVORITES_TAB_ID}
            role="tab"
            aria-selected={isFavoritesActive}
            className={`template-tab${isFavoritesActive ? ' active' : ''}`}
            onClick={() => setActiveSectionId(FAVORITES_TAB_ID)}
            title={t('templatePanel.favorites')}
          >
            ⭐ {t('templatePanel.favorites')}
          </button>
          {sorted.map((section) => (
            <button
              key={section.id}
              role="tab"
              aria-selected={section.id === resolvedId}
              className={`template-tab${section.id === resolvedId ? ' active' : ''}`}
              onClick={() => setActiveSectionId(section.id)}
            >
              {t(section.categoryKey, section.categoryKey)}
            </button>
          ))}
        </div>
      )}

      <div className="template-grid">
        {displayedItems.length > 0 ? (
          displayedItems.map((item) => {
            const isSelected = selectedTemplateId === item.id &&
              (!item.id.startsWith('tpl:jct:') || pendingTemplateId === item.id) &&
              (!item.id.startsWith('tpl:road:') || editMode === 'spline');
            const isPending = pendingTemplateId === item.id;
            return (
            <div
              key={item.id}
              className={`template-item${isSelected ? ' selected' : ''}${isPending ? ' pending' : ''}`}
              title={t(item.labelKey, item.labelKey)}
              draggable
              onDragStart={(e) => handleDragStart(e, item.id)}
              onClick={() => handleItemClick(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleItemClick(item.id);
                }
              }}
            >
              <div className="template-thumb">{item.icon}</div>
              <div className="template-label">{t(item.labelKey, item.labelKey)}</div>
              <button
                className={`template-fav-btn${favorites.includes(item.id) ? ' active' : ''}`}
                title={favorites.includes(item.id) ? t('templatePanel.unfavorite') : t('templatePanel.addFavorite')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(item.id);
                }}
                aria-label={favorites.includes(item.id) ? t('templatePanel.unfavorite') : t('templatePanel.addFavorite')}
              >
                <Star size={11} fill={favorites.includes(item.id) ? 'currentColor' : 'none'} />
              </button>
            </div>
            );
          })
        ) : isFavoritesActive ? (
          <div className="template-empty">{t('templatePanel.noFavorites')}</div>
        ) : (
          <div className="template-empty">{t('templatePanel.noTemplates')}</div>
        )}
      </div>
    </div>
  );
}
