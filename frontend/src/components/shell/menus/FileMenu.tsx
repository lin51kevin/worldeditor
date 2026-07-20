import type { Project } from '../../../services/platform';
import { useProjectStore } from '../../../stores/projectStore';
import type { ExporterContrib, ImporterContrib } from '../../../stores/pluginContribStore';
import type { RecentFile } from '../../../stores/recentFilesStore';
import { showAlert, showConfirm } from '../../../utils/dialog';
import { isExportCancelled } from '../../../utils/exportErrors';
import type { MenuItem, TranslateFn } from '../menuDefinitions';
import { MenuSection, type MenuSectionInteractionProps } from './MenuSection';

const MAX_IMPORT_SIZE_BYTES = 50 * 1024 * 1024;

type MenuAction = () => void | Promise<void>;

interface FileMenuProps extends MenuSectionInteractionProps {
  t: TranslateFn;
  project: Project;
  isDirty: boolean;
  recentFiles: RecentFile[];
  importers: ImporterContrib[];
  exporters: ExporterContrib[];
  clearRecentFiles: () => void;
  onNew: MenuAction;
  onCloseFile: MenuAction;
  onOpen: MenuAction;
  onSave: MenuAction;
  onSaveAs: MenuAction;
  onExit: MenuAction;
  onImportOpenDrive: MenuAction;
  onImportPointCloud: MenuAction;
  onImportTrajectory: MenuAction;
  onOpenRecentFile: (file: RecentFile) => Promise<void>;
  onExportOpenDrive: MenuAction;
}

export function FileMenu({
  t,
  project,
  isDirty,
  recentFiles,
  importers,
  exporters,
  clearRecentFiles,
  onNew,
  onCloseFile,
  onOpen,
  onSave,
  onSaveAs,
  onExit,
  onImportOpenDrive,
  onImportPointCloud,
  onImportTrajectory,
  onOpenRecentFile,
  onExportOpenDrive,
  ...menuProps
}: FileMenuProps) {
  const recentSubmenu: MenuItem[] = recentFiles.length === 0
    ? [{ label: t('menu.noRecentFiles'), disabled: true }]
    : [
        ...recentFiles.map((file): MenuItem => ({
          label: file.name,
          action: () => {
            void onOpenRecentFile(file);
          },
        })),
        { separator: true, label: '' },
        { label: t('menu.clearRecentFiles'), action: async () => {
          const confirmed = await showConfirm(t('dialog.confirmClearRecent'));
          if (confirmed) clearRecentFiles();
        } },
      ];

  const importSubmenu: MenuItem[] = [
    {
      label: t('menu.importOpenDrive'),
      action: () => {
        void onImportOpenDrive();
      },
    },
    {
      label: t('menu.importPointCloud'),
      shortcut: 'Ctrl+Alt+G',
      action: () => {
        void onImportPointCloud();
      },
    },
    {
      label: t('menu.importTrajectory'),
      shortcut: 'Ctrl+Alt+T',
      action: () => {
        void onImportTrajectory();
      },
    },
    ...importers.filter((importer) => !importer.disabled).map((importer): MenuItem => ({
      label: `${t('menu.import')} ${importer.formatName}...`,
      action: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = importer.extensions.join(',');
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            if (file.size > MAX_IMPORT_SIZE_BYTES) {
              await showAlert(`${t('dialog.importError')}: file exceeds 50 MB import limit`, t('dialog.errorTitle') || 'Error');
              return;
            }
            const content = await file.arrayBuffer();
            const importedProject = await importer.onImport(content, file.name);
            if (!importedProject || !Array.isArray(importedProject.roads)) {
              await showAlert(`${t('dialog.importError')}: ${t('dialog.importInvalidProject')}`, t('dialog.errorTitle') || 'Error');
              return;
            }
            importedProject.name = file.name;
            if (importedProject.roads.length === 0) {
              await showAlert(t('dialog.importEmptyProject'), t('dialog.warningTitle'));
            }
            useProjectStore.getState().setProject(importedProject);
            await showAlert(`${t('dialog.importSuccess')}: ${file.name}`, t('dialog.successTitle'));
          } catch (err) {
            console.error('[FileMenu] Import failed:', err);
            await showAlert(`${t('dialog.importError')}: ${err instanceof Error ? err.message : String(err)}`, t('dialog.errorTitle') || 'Error');
          }
        };
        input.click();
      },
    })),
  ];

  const exportSubmenu: MenuItem[] = [
    {
      label: t('menu.exportOpenDrive'),
      action: () => {
        void onExportOpenDrive();
      },
      disabled: project.roads.length === 0,
    },
    ...exporters.filter((exporter) => !exporter.disabled).map((exporter): MenuItem => ({
      label: `${t('menu.export')} ${exporter.formatName}...`,
      action: async () => {
        try {
          await exporter.onExport(project);
          await showAlert(`${t('dialog.exportSuccess')}: ${exporter.formatName}`, t('dialog.successTitle'));
        } catch (err) {
          if (isExportCancelled(err)) {
            return; // User cancelled the save dialog — no success, no error.
          }
          console.error('[FileMenu] Export failed:', err);
          await showAlert(`${t('dialog.exportError')}: ${exporter.formatName}: ${err instanceof Error ? err.message : String(err)}`, t('dialog.errorTitle') || 'Error');
        }
      },
    })),
  ];

  const menu = {
    label: t('menu.file'),
    items: [
      {
        label: t('menu.new'),
        shortcut: 'Ctrl+N',
        action: () => {
          void onNew();
        },
      },
      {
        label: t('menu.openFile'),
        shortcut: 'Ctrl+O',
        action: () => {
          void onOpen();
        },
      },
      { label: t('menu.openRecentFiles'), submenu: recentSubmenu },
      { separator: true, label: '' },
      { label: t('menu.import'), submenu: importSubmenu },
      { label: t('menu.export'), submenu: exportSubmenu },
      { separator: true, label: '' },
      {
        label: t('menu.save'),
        shortcut: 'Ctrl+S',
        action: () => {
          void onSave();
        },
        disabled: !isDirty,
      },
      {
        label: t('menu.saveAs'),
        shortcut: 'Ctrl+Shift+S',
        action: () => {
          void onSaveAs();
        },
      },
      { separator: true, label: '' },
      {
        label: t('menu.closeFile'),
        shortcut: 'Ctrl+W',
        action: () => {
          void onCloseFile();
        },
      },
      {
        label: t('menu.exit'),
        action: () => {
          void onExit();
        },
      },
    ],
  };

  return <MenuSection menu={menu} {...menuProps} />;
}
