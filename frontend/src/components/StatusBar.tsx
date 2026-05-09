import { Circle, CheckCircle2, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import './StatusBar.css';

export function StatusBar() {
  const { project, isDirty, cursorWorldPos } = useEditorStore();
  const { t } = useTranslation();

  return (
    <div className="statusbar">
      <span className="statusbar-item">
        {t('statusBar.roads')}: {project.roads.length} | {t('statusBar.junctions')}: {project.junctions.length}
      </span>
      <span className="statusbar-item">
        <MapPin size={11} />
        {t('statusBar.worldCoord')}: {cursorWorldPos.x.toFixed(3)}, {cursorWorldPos.y.toFixed(3)}
      </span>
      <span className="statusbar-item">
        {isDirty
          ? <><Circle size={10} fill="currentColor" /> {t('statusBar.modified')}</>
          : <><CheckCircle2 size={10} /> {t('statusBar.saved')}</>
        }
      </span>
    </div>
  );
}
