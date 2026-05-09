import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import './StatusBar.css';

export function StatusBar() {
  const { cursorWorldPos } = useEditorStore();
  const { t } = useTranslation();

  return (
    <div className="statusbar">
      <span className="statusbar-item">
        <MapPin size={11} />
        {t('statusBar.worldCoord')}: {cursorWorldPos.x.toFixed(3)}, {cursorWorldPos.y.toFixed(3)}
      </span>
    </div>
  );
}
