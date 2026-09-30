import {validateFoeUploads} from './foeUploadValidation';

test('validates every root and embedded file before any transfer', () => {
  const file = {size: 32, type: 'image/png'};
  expect(() => validateFoeUploads({spells: [{imageFile: file}], tecniche: [{imageFile: file}]}, file)).not.toThrow();
  expect(() => validateFoeUploads({}, {...file, size: 9 * 1024 * 1024})).toThrow(/size limit/);
  expect(() => validateFoeUploads({spells: [{imageFile: {...file, type: 'image/svg+xml'}}]}, file)).toThrow(/SVG/);
  expect(() => validateFoeUploads({tecniche: [{imageFile: {...file, size: 0}}]})).toThrow(/empty/);
});
