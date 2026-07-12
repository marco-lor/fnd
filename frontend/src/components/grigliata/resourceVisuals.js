import { FaDiceD20 } from 'react-icons/fa';
import { GiHearts, GiMagicSwirl, GiShield } from 'react-icons/gi';

export const GRIGLIATA_RESOURCE_VISUALS = Object.freeze({
  hp: Object.freeze({
    key: 'hp',
    label: 'HP',
    Icon: GiHearts,
    boardClassName: 'border-emerald-100/90 bg-emerald-600/95 text-white',
    subtleClassName: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
    focusClassName: 'focus:border-emerald-300',
  }),
  mana: Object.freeze({
    key: 'mana',
    label: 'Mana',
    Icon: GiMagicSwirl,
    boardClassName: 'border-cyan-100/90 bg-sky-600/95 text-white',
    subtleClassName: 'border-sky-400/25 bg-sky-500/10 text-sky-100',
    focusClassName: 'focus:border-sky-300',
  }),
  shield: Object.freeze({
    key: 'shield',
    label: 'Shield',
    Icon: GiShield,
    boardClassName: 'border-amber-100/95 bg-amber-500/95 text-white',
    subtleClassName: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
    focusClassName: 'focus:border-amber-300',
  }),
});

export const GRIGLIATA_ANIMA_VISUAL = Object.freeze({
  label: 'Anima',
  Icon: FaDiceD20,
  subtleClassName: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
});
