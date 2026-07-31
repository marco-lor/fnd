import { createElement, useEffect, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GiBleedingWound,
  GiBlindfold,
  GiBrokenBone,
  GiCharm,
  GiCrossedChains,
  GiFire,
  GiFluffyWing,
  GiFrozenBody,
  GiHeavyFall,
  GiKnockedOutStars,
  GiMagicShield,
  GiMeditation,
  GiNightSleep,
  GiPoisonBottle,
  GiSilenced,
  GiSnail,
  GiSpiderWeb,
  GiStoneBust,
  GiTargeting,
  GiTerror,
  GiUpgrade,
} from 'react-icons/gi';

const GROUP_STYLES = {
  conditions: {
    accentColor: '#60a5fa',
    badgeFill: 'rgba(15, 23, 42, 0.92)',
    badgeStroke: 'rgba(96, 165, 250, 0.9)',
  },
  hazards: {
    accentColor: '#f97316',
    badgeFill: 'rgba(30, 20, 12, 0.92)',
    badgeStroke: 'rgba(249, 115, 22, 0.92)',
  },
  buffs: {
    accentColor: '#34d399',
    badgeFill: 'rgba(6, 20, 18, 0.92)',
    badgeStroke: 'rgba(52, 211, 153, 0.92)',
  },
};

export const GRIGLIATA_TOKEN_STATUS_GROUPS = [
  { id: 'conditions', label: 'Conditions' },
  { id: 'hazards', label: 'Hazards' },
  { id: 'buffs', label: 'Buffs / Tactics' },
];

const createStatusDefinition = ({ id, label, group, icon: Icon }) => ({
  id,
  label,
  group,
  icon: Icon,
  ...GROUP_STYLES[group],
});

export const GRIGLIATA_TOKEN_STATUSES = [
  createStatusDefinition({ id: 'bleeding', label: 'Bleeding', group: 'hazards', icon: GiBleedingWound }),
  createStatusDefinition({ id: 'blinded', label: 'Blinded', group: 'conditions', icon: GiBlindfold }),
  createStatusDefinition({ id: 'burning', label: 'Burning', group: 'hazards', icon: GiFire }),
  createStatusDefinition({ id: 'charmed', label: 'Charmed', group: 'conditions', icon: GiCharm }),
  createStatusDefinition({ id: 'concentrating', label: 'Concentrating', group: 'buffs', icon: GiMeditation }),
  createStatusDefinition({ id: 'crippled', label: 'Crippled', group: 'conditions', icon: GiBrokenBone }),
  createStatusDefinition({ id: 'flying', label: 'Flying', group: 'buffs', icon: GiFluffyWing }),
  createStatusDefinition({ id: 'frightened', label: 'Frightened', group: 'conditions', icon: GiTerror }),
  createStatusDefinition({ id: 'frozen', label: 'Frozen', group: 'hazards', icon: GiFrozenBody }),
  createStatusDefinition({ id: 'grappled', label: 'Grappled', group: 'conditions', icon: GiCrossedChains }),
  createStatusDefinition({ id: 'hastened', label: 'Hastened', group: 'buffs', icon: GiUpgrade }),
  createStatusDefinition({ id: 'marked', label: 'Marked', group: 'buffs', icon: GiTargeting }),
  createStatusDefinition({ id: 'petrified', label: 'Petrified', group: 'conditions', icon: GiStoneBust }),
  createStatusDefinition({ id: 'poisoned', label: 'Poisoned', group: 'hazards', icon: GiPoisonBottle }),
  createStatusDefinition({ id: 'prone', label: 'Prone', group: 'conditions', icon: GiHeavyFall }),
  createStatusDefinition({ id: 'restrained', label: 'Restrained', group: 'conditions', icon: GiSpiderWeb }),
  createStatusDefinition({ id: 'shielded', label: 'Shielded', group: 'buffs', icon: GiMagicShield }),
  createStatusDefinition({ id: 'silenced', label: 'Silenced', group: 'conditions', icon: GiSilenced }),
  createStatusDefinition({ id: 'sleeping', label: 'Sleeping', group: 'conditions', icon: GiNightSleep }),
  createStatusDefinition({ id: 'slowed', label: 'Slowed', group: 'conditions', icon: GiSnail }),
  createStatusDefinition({ id: 'stunned', label: 'Stunned', group: 'conditions', icon: GiKnockedOutStars }),
];

export const MAX_GRIGLIATA_TOKEN_STATUSES = GRIGLIATA_TOKEN_STATUSES.length;

const tokenStatusDefinitionMap = new Map(
  GRIGLIATA_TOKEN_STATUSES.map((status) => [status.id, status])
);

const iconDataUrlCache = new Map();
const iconImageCache = new Map();
const iconImagePromiseCache = new Map();

export const getTokenStatusDefinition = (statusId) => tokenStatusDefinitionMap.get(statusId) || null;

export const normalizeTokenStatuses = (value) => {
  if (!Array.isArray(value)) return [];

  const seenStatusIds = new Set();
  const nextStatuses = [];

  value.forEach((entry) => {
    const statusId = typeof entry === 'string' ? entry.trim() : '';
    if (!statusId || seenStatusIds.has(statusId) || !tokenStatusDefinitionMap.has(statusId)) {
      return;
    }

    seenStatusIds.add(statusId);
    nextStatuses.push(statusId);
  });

  return nextStatuses;
};

export const toggleTokenStatus = (currentStatuses, statusId) => {
  const normalizedStatusId = typeof statusId === 'string' ? statusId.trim() : '';
  const normalizedStatuses = normalizeTokenStatuses(currentStatuses);
  if (!tokenStatusDefinitionMap.has(normalizedStatusId)) {
    return normalizedStatuses;
  }

  const nextStatuses = normalizedStatuses.filter((entry) => entry !== normalizedStatusId);
  if (nextStatuses.length !== normalizedStatuses.length) {
    return nextStatuses;
  }

  return [normalizedStatusId, ...normalizedStatuses];
};

export const splitTokenStatusesForDisplay = (statuses, maxVisible = 3) => {
  const normalizedStatuses = normalizeTokenStatuses(statuses);
  const safeMaxVisible = Math.max(0, Number.isFinite(maxVisible) ? Math.floor(maxVisible) : 3);
  const visibleStatuses = normalizedStatuses.slice(0, safeMaxVisible);
  const overflowStatuses = normalizedStatuses.slice(safeMaxVisible);

  return {
    visibleStatuses,
    overflowStatuses,
    overflowCount: overflowStatuses.length,
  };
};

const buildTokenStatusIconDataUrl = (statusId) => {
  if (iconDataUrlCache.has(statusId)) {
    return iconDataUrlCache.get(statusId);
  }

  const status = getTokenStatusDefinition(statusId);
  if (!status) {
    return '';
  }

  const svgMarkup = renderToStaticMarkup(createElement(status.icon, {
    color: '#f8fafc',
    size: 32,
  }));
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  iconDataUrlCache.set(statusId, dataUrl);
  return dataUrl;
};

const loadTokenStatusIconImage = (statusId) => {
  if (iconImageCache.has(statusId)) {
    return Promise.resolve(iconImageCache.get(statusId));
  }

  if (iconImagePromiseCache.has(statusId)) {
    return iconImagePromiseCache.get(statusId);
  }

  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  const dataUrl = buildTokenStatusIconDataUrl(statusId);
  if (!dataUrl) {
    return Promise.resolve(null);
  }

  const image = new window.Image();
  const promise = new Promise((resolve) => {
    image.onload = () => {
      iconImageCache.set(statusId, image);
      iconImagePromiseCache.delete(statusId);
      resolve(image);
    };

    image.onerror = () => {
      iconImagePromiseCache.delete(statusId);
      resolve(null);
    };
  });

  iconImagePromiseCache.set(statusId, promise);
  image.src = dataUrl;
  return promise;
};

export const useTokenStatusIconImages = (statusIds) => {
  const normalizedStatusIds = useMemo(
    () => [...new Set(normalizeTokenStatuses(statusIds))],
    [statusIds]
  );
  const normalizedStatusIdsKey = normalizedStatusIds.join('|');
  const [images, setImages] = useState(() => {
    const nextImages = {};

    normalizedStatusIds.forEach((statusId) => {
      const cachedImage = iconImageCache.get(statusId);
      if (cachedImage) {
        nextImages[statusId] = cachedImage;
      }
    });

    return nextImages;
  });

  useEffect(() => {
    let isActive = true;

    normalizedStatusIds.forEach((statusId) => {
      if (iconImageCache.has(statusId)) {
        const cachedImage = iconImageCache.get(statusId);
        setImages((currentImages) => (
          currentImages[statusId] === cachedImage
            ? currentImages
            : {
              ...currentImages,
              [statusId]: cachedImage,
            }
        ));
        return;
      }

      void loadTokenStatusIconImage(statusId).then((loadedImage) => {
        if (!isActive || !loadedImage) {
          return;
        }

        setImages((currentImages) => (
          currentImages[statusId] === loadedImage
            ? currentImages
            : {
              ...currentImages,
              [statusId]: loadedImage,
            }
        ));
      });
    });

    return () => {
      isActive = false;
    };
  }, [normalizedStatusIds, normalizedStatusIdsKey]);

  return images;
};
