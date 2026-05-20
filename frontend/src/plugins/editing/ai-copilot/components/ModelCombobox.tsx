import { useState, useRef, useCallback, useEffect } from 'react';
import { RefreshCw, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './ModelCombobox.css';

interface ModelComboboxProps {
  value: string;
  onChange: (value: string) => void;
  presetModels: string[];
  placeholder?: string;
  onFetchModels?: () => Promise<string[]>;
}

/**
 * Custom combobox for model selection.
 * Supports free-form text input/paste AND dropdown selection from preset + fetched models.
 */
export function ModelCombobox({
  value,
  onChange,
  presetModels,
  placeholder,
  onFetchModels,
}: ModelComboboxProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Merge preset + fetched, deduplicate
  const allModels = Array.from(new Set([...presetModels, ...fetchedModels]));

  // Filter models by input text
  const filterText = isOpen ? filter : '';
  const filteredModels = filterText
    ? allModels.filter((m) => m.toLowerCase().includes(filterText.toLowerCase()))
    : allModels;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      onChange(val);
      setFilter(val);
      if (!isOpen) setIsOpen(true);
    },
    [onChange, isOpen]
  );

  const handleInputFocus = useCallback(() => {
    setFilter(value);
    setIsOpen(true);
  }, [value]);

  const handleSelect = useCallback(
    (model: string) => {
      onChange(model);
      setFilter('');
      setIsOpen(false);
    },
    [onChange]
  );

  const handleFetch = useCallback(async () => {
    if (!onFetchModels || fetching) return;
    setFetching(true);
    setFetchError(false);
    try {
      const models = await onFetchModels();
      setFetchedModels(models);
    } catch {
      setFetchError(true);
    } finally {
      setFetching(false);
    }
  }, [onFetchModels, fetching]);

  const handleToggle = useCallback(() => {
    if (!isOpen) {
      setFilter(value);
    }
    setIsOpen((prev) => !prev);
  }, [isOpen, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      } else if (e.key === 'Enter' && isOpen) {
        // If there are filtered results, select the first one
        if (filteredModels.length > 0 && filter) {
          onChange(filteredModels[0]!);
          setFilter('');
          setIsOpen(false);
          e.preventDefault();
        }
      }
    },
    [isOpen, filteredModels, filter, onChange]
  );

  return (
    <div className="model-combobox" ref={containerRef}>
      <div className="model-combobox-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="model-combobox-input"
          value={value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || t('copilot.settingsModelPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          data-testid="model-combobox-input"
        />
        <button
          className="model-combobox-toggle"
          onClick={handleToggle}
          type="button"
          tabIndex={-1}
          aria-label="Toggle model list"
        >
          <ChevronDown size={12} className={isOpen ? 'model-combobox-chevron--open' : ''} />
        </button>
      </div>

      {/* Hint text */}
      <div className="model-combobox-hint">
        {t('copilot.settingsModelHint')}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="model-combobox-dropdown" data-testid="model-combobox-dropdown">
          {/* Fetch button */}
          {onFetchModels && (
            <div className="model-combobox-fetch-row">
              <button
                className="model-combobox-fetch-btn"
                onClick={handleFetch}
                disabled={fetching}
                type="button"
                data-testid="model-fetch-btn"
              >
                <RefreshCw size={11} className={fetching ? 'model-combobox-spin' : ''} />
                {fetching
                  ? t('copilot.settingsFetchingModels')
                  : t('copilot.settingsFetchModels')}
              </button>
              {fetchError && (
                <span className="model-combobox-fetch-error">
                  {t('copilot.settingsFetchModelsError')}
                </span>
              )}
            </div>
          )}

          {/* Model list */}
          <div className="model-combobox-list">
            {filteredModels.length === 0 ? (
              <div className="model-combobox-empty">
                {filter ? t('copilot.settingsNoMatchingModels') : t('copilot.settingsNoModels')}
              </div>
            ) : (
              filteredModels.map((m) => (
                <button
                  key={m}
                  className={`model-combobox-item${m === value ? ' model-combobox-item--active' : ''}`}
                  onClick={() => handleSelect(m)}
                  type="button"
                  title={m}
                >
                  {m}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
