import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiCheck, FiChevronDown, FiFolder } from 'react-icons/fi';
import { buildMediaFolderOptions } from './mediaFolders';

const TONE_CLASS_NAMES = {
  sky: {
    icon: 'text-sky-200',
    openButton: 'border-sky-400/70 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.22)]',
    closedButton: 'border-slate-700 bg-slate-950/70 hover:border-sky-500/50 hover:bg-slate-900/80',
    popup: 'border-sky-500/35',
    selectedOption: 'bg-sky-500/20 text-sky-100',
    optionIcon: 'text-sky-200/80',
    check: 'text-sky-200',
  },
  violet: {
    icon: 'text-violet-200',
    openButton: 'border-violet-400/70 bg-violet-500/10 shadow-[0_0_0_1px_rgba(167,139,250,0.22)]',
    closedButton: 'border-slate-700 bg-slate-950/70 hover:border-violet-500/50 hover:bg-slate-900/80',
    popup: 'border-violet-500/35',
    selectedOption: 'bg-violet-500/20 text-violet-100',
    optionIcon: 'text-violet-200/80',
    check: 'text-violet-200',
  },
};

export default function MediaFolderFilterButton({
  folders = [],
  selectedFolderId = '__unfiled__',
  onSelectedFolderIdChange,
  buttonLabel,
  listboxLabel,
  tone = 'sky',
  onBeforeOpen,
  LeadingIcon = FiFolder,
  size = 'default',
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const filterRef = useRef(null);
  const toneClassNames = TONE_CLASS_NAMES[tone] || TONE_CLASS_NAMES.sky;
  const folderOptions = useMemo(() => buildMediaFolderOptions(folders), [folders]);
  const selectedFolder = folderOptions.find((folder) => folder.id === selectedFolderId) || folderOptions[0];
  const isCompact = size === 'compact';
  const buttonClassName = isCompact
    ? 'h-9 gap-2 rounded-md px-2.5 py-1.5'
    : 'gap-3 rounded-lg px-3 py-2';
  const iconClassName = isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const textClassName = isCompact ? 'text-[11px]' : 'text-xs';
  const chevronClassName = isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4';

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleDocumentMouseDown = (event) => {
      if (!filterRef.current || filterRef.current.contains(event.target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleDocumentKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={filterRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={buttonLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`${buttonLabel.replace(/\s+/g, '-').toLowerCase()}-options`}
        onClick={() => {
          onBeforeOpen?.();
          setIsOpen((currentValue) => !currentValue);
        }}
        className={`flex w-full items-center justify-between border text-left transition-colors ${buttonClassName} ${
          isOpen ? toneClassNames.openButton : toneClassNames.closedButton
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <LeadingIcon className={`${iconClassName} shrink-0 ${toneClassNames.icon}`} aria-hidden="true" />
          <span className={`truncate font-semibold text-slate-100 ${textClassName}`}>
            {selectedFolder?.name || 'Unfiled'}
          </span>
        </span>
        <FiChevronDown
          className={`${chevronClassName} shrink-0 text-slate-300 transition-transform ${isOpen ? `rotate-180 ${toneClassNames.icon}` : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div className={`absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border ${toneClassNames.popup} bg-slate-950 shadow-2xl shadow-black/60`}>
          <div
            id={`${buttonLabel.replace(/\s+/g, '-').toLowerCase()}-options`}
            role="listbox"
            aria-label={listboxLabel}
            className="max-h-52 overflow-y-auto custom-scroll bg-slate-950 p-1"
          >
            {folderOptions.map((folder) => {
              const isSelectedFilter = selectedFolderId === folder.id;

              return (
                <button
                  key={folder.id}
                  type="button"
                  role="option"
                  aria-selected={isSelectedFilter}
                  onClick={() => {
                    onSelectedFolderIdChange?.(folder.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                    isSelectedFilter
                      ? toneClassNames.selectedOption
                      : 'text-slate-200 hover:bg-slate-800/85 hover:text-white'
                  }`}
                >
                  <FiFolder className={`h-3.5 w-3.5 shrink-0 ${toneClassNames.optionIcon}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  {isSelectedFilter && (
                    <FiCheck className={`h-3.5 w-3.5 shrink-0 ${toneClassNames.check}`} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
