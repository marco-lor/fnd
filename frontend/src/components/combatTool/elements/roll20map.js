import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva';
import Konva from 'konva'; // Import Konva itself for specific functionalities if needed

// Helper hook for loading images with Konva integration
const useImageLoader = (src) => {
  const [image, setImage] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!src) {
      setImage(null);
      setDimensions({ width: 0, height: 0 });
      return;
    }
    const img = new window.Image();
    img.src = src;
    img.onload = () => {
      setImage(img);
      setDimensions({ width: img.width, height: img.height });
    };
    img.onerror = (err) => {
      console.error("Failed to load image:", src, err);
      setImage(null);
      setDimensions({ width: 0, height: 0 });
    }
    // Optional: Add cleanup if the component unmounts before loading finishes
    return () => {
        img.onload = null;
        img.onerror = null;
    };
  }, [src]); // Reload image if src changes

  return [image, dimensions];
};


const Roll20Map = ({ mapUrl, initialTokens = [], gridSize = 50, onTokenMove }) => {
  const [mapImage, mapDimensions] = useImageLoader(mapUrl);
  const [tokens, setTokens] = useState([]);
  const stageRef = useRef(null);
  const containerRef = useRef(null); // Ref for the container div
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 }); // Size of the stage/canvas

  // --- Image Loading for Tokens ---
  // We need to load images for each token separately
  useEffect(() => {
    const loadTokenImages = async () => {
        const loadedTokens = await Promise.all(initialTokens.map(async (tokenData) => {
            return new Promise((resolve, reject) => {
                if (!tokenData.imageUrl) {
                    console.warn(`Token ${tokenData.id} has no imageUrl.`);
                    resolve({ ...tokenData, image: null, width: gridSize, height: gridSize }); // Default size if no image
                    return;
                }
                const img = new window.Image();
                img.src = tokenData.imageUrl;
                img.onload = () => {
                    // You might want to scale the token image to fit the grid size
                    // or use its natural size if appropriate. Here we default to grid size.
                    resolve({
                        ...tokenData,
                        image: img,
                        // Use image's natural size or enforce grid size? Let's enforce for now.
                        width: tokenData.width || gridSize,
                        height: tokenData.height || gridSize,
                    });
                };
                img.onerror = (err) => {
                    console.error(`Failed to load token image: ${tokenData.imageUrl}`, err);
                    resolve({ ...tokenData, image: null, width: gridSize, height: gridSize }); // Default on error
                };
            });
        }));
        setTokens(loadedTokens);
    };

    loadTokenImages();
  }, [initialTokens, gridSize]); // Reload if initial tokens or grid size change

  // --- Stage Resizing ---
  // Adjust stage size to fit its container
  useEffect(() => {
    const checkSize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight, // Or set a fixed height/aspect ratio
        });
      }
    };
    checkSize(); // Initial check
    window.addEventListener('resize', checkSize); // Adjust on window resize
    // Optional: Use ResizeObserver for more robust container resize detection
    // const resizeObserver = new ResizeObserver(checkSize);
    // if (containerRef.current) {
    //   resizeObserver.observe(containerRef.current);
    // }

    return () => {
      window.removeEventListener('resize', checkSize);
      // if (containerRef.current) {
      //   resizeObserver.unobserve(containerRef.current);
      // }
    };
  }, []); // Run only once on mount

  // --- Grid Drawing ---
  const renderGrid = () => {
    if (!mapDimensions.width || !gridSize) return null; // Don't draw if no map or grid size

    const lines = [];
    const strokeColor = 'rgba(255, 255, 255, 0.3)'; // Light grey grid lines
    const strokeWidth = 1;

    // Vertical lines
    for (let i = 0; i <= Math.ceil(mapDimensions.width / gridSize); i++) {
      lines.push(
        <Line
          key={`v-${i}`}
          points={[i * gridSize, 0, i * gridSize, mapDimensions.height]}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          listening={false} // Prevent grid lines from interfering with drag events
        />
      );
    }

    // Horizontal lines
    for (let j = 0; j <= Math.ceil(mapDimensions.height / gridSize); j++) {
      lines.push(
        <Line
          key={`h-${j}`}
          points={[0, j * gridSize, mapDimensions.width, j * gridSize]}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          listening={false}
        />
      );
    }
    return lines;
  };

  // --- Token Drag Handling ---
  const handleDragEnd = useCallback((e, tokenId) => {
    const node = e.target;
    const newX = node.x();
    const newY = node.y();

    // Snap to grid
    const snappedX = Math.round(newX / gridSize) * gridSize;
    const snappedY = Math.round(newY / gridSize) * gridSize;

    // Prevent dragging tokens off the map (optional)
    const boundedX = Math.max(0, Math.min(snappedX, mapDimensions.width - (node.width() || gridSize)));
    const boundedY = Math.max(0, Math.min(snappedY, mapDimensions.height - (node.height() || gridSize)));

    // Update visual position immediately for smoothness before state update
    node.position({ x: boundedX, y: boundedY });

    // Update the state
    setTokens(prevTokens =>
      prevTokens.map(token =>
        token.id === tokenId ? { ...token, x: boundedX, y: boundedY } : token
      )
    );

    // Callback to parent component (e.g., to save to Firebase)
    if (onTokenMove) {
      onTokenMove(tokenId, { x: boundedX, y: boundedY });
    }
  }, [gridSize, mapDimensions.width, mapDimensions.height, onTokenMove]); // Dependencies for snapping/bounding/callback


  // --- Rendering ---
  return (
    // This container div determines the size of the Stage
    <div ref={containerRef} style={{ width: '100%', height: '70vh', border: '1px solid #444', overflow: 'auto', backgroundColor: '#2d2d2d' }}>
      {/* We might need overflow: hidden; if stage panning/zooming is added later */}
      <Stage
        ref={stageRef}
        width={stageSize.width} // Use dynamic size
        height={stageSize.height} // Use dynamic size
        // Optional: Add drag functionality to the stage itself for panning
        // draggable
      >
        {/* Map Layer */}
        <Layer>
          {mapImage && (
            <KonvaImage
              image={mapImage}
              width={mapDimensions.width}
              height={mapDimensions.height}
              listening={false} // Map shouldn't interfere with clicks/drags
            />
          )}
        </Layer>

        {/* Grid Layer (drawn on top of map) */}
        <Layer>
           {mapDimensions.width > 0 && renderGrid()}
        </Layer>

        {/* Token Layer (drawn on top of grid) */}
        <Layer>
          {tokens.map((token) => (
            token.image ? ( // Only render if image is loaded
              <KonvaImage
                key={token.id}
                id={token.id} // Konva uses id internally, but key is for React
                image={token.image}
                x={token.x}
                y={token.y}
                width={token.width}
                height={token.height}
                draggable
                onDragEnd={(e) => handleDragEnd(e, token.id)}
                // Optional: Add drag bounds if not handled in dragEnd
                // dragBoundFunc={(pos) => {
                //   const newX = Math.max(0, Math.min(pos.x, mapDimensions.width - token.width));
                //   const newY = Math.max(0, Math.min(pos.y, mapDimensions.height - token.height));
                //   return { x: newX, y: newY };
                // }}
              />
            ) : null // Don't render token if its image hasn't loaded or failed
          ))}
        </Layer>
      </Stage>
    </div>
  );
};

export default Roll20Map;