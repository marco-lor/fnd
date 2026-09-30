import {validateTask07UploadCandidate} from '../../data/media/mediaPolicy';

export const validateFoeUploads = (foe, imageFile) => {
  const files = [imageFile, ...['spells', 'tecniche'].flatMap(key =>
    (Array.isArray(foe?.[key]) ? foe[key] : []).map(entry => entry.imageFile))].filter(Boolean);
  // Validate the entire save before its first upload, including the legacy path.
  for (const file of files) {
    const result = validateTask07UploadCandidate({file, purpose: 'foe'});
    if (!result.ok) throw new Error(result.message);
  }
};
