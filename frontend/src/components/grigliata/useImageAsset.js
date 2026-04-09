import { useEffect, useState } from 'react';

export default function useImageAsset(src) {
  const [image, setImage] = useState(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return undefined;
    }

    let active = true;
    const nextImage = new window.Image();

    nextImage.onload = () => {
      if (active) {
        setImage(nextImage);
      }
    };

    nextImage.onerror = () => {
      if (active) {
        setImage(null);
      }
    };

    nextImage.src = src;

    return () => {
      active = false;
    };
  }, [src]);

  return image;
}
