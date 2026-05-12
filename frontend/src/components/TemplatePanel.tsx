import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePluginContribStore } from '../stores/pluginContribStore';
import './TemplatePanel.css';

export function TemplatePanel() {
  const { t } = useTranslation();
  const templateSections = usePluginContribStore((s) => s.templateSections);

  const sorted = useMemo(
    () => [...templateSections].sort((a, b) => a.order - b.order),
    [templateSections],
  );

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  // Resolve active section: use stored id if still valid, otherwise fall back to first
  const resolvedId = sorted.some((s) => s.id === activeSectionId)
    ? activeSectionId
    : sorted[0]?.id ?? null;

  const activeSection = sorted.find((s) => s.id === resolvedId) ?? null;

  const handleItemClick = (itemId: string) => {
    activeSection?.items.find((i) => i.id === itemId)?.onApply();
  };

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('application/we-template-id', itemId);
    e.dataTransfer.setData('application/we-template-section', resolvedId ?? '');
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="template-panel">
      <div className="template-header">
        <span>{t('templatePanel.header')}</span>
      </div>

      {sorted.length > 0 && (
        <div className="template-tabs" role="tablist">
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
        {activeSection ? (
          activeSection.items.map((item) => (
            <div
              key={item.id}
              className="template-item"
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
            </div>
          ))
        ) : (
          <div className="template-empty">{t('templatePanel.noTemplates')}</div>
        )}
      </div>
    </div>
  );
}
