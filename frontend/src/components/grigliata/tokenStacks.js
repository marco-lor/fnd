import polygonClipping from 'polygon-clipping';
import { getGridCellPositionPx, getTokenPositionPx, normalizeTokenSizeSquares } from './boardUtils';
import { decodeFogCellKey } from './fogOfWar';
import { getFogPolygonBounds } from './fogPolygonGeometry';
import { buildCurrentVisiblePolygons, pointIsInsideFogPolygon } from './fogVisibilityFiltering';

const cellKey = (col, row) => `${col}:${row}`;
const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const boundsOverlap = (a, b) => (
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
);

const getTokenBody = (token, grid) => {
  const { x, y, size } = token.renderPosition || token.position || getTokenPositionPx(token, grid);
  const halfSize = size / 2;
  // TokenNode's listening body extends one pixel beyond its clipped portrait.
  return { x: x + halfSize, y: y + halfSize, radius: halfSize - 1 };
};

const pointHitsBody = (point, body) => (
  (point.x - body.x) ** 2 + (point.y - body.y) ** 2 < body.radius ** 2
);

const bodyOverlapsBounds = (body, bounds) => pointHitsBody({
  x: Math.min(bounds.maxX, Math.max(bounds.minX, body.x)),
  y: Math.min(bounds.maxY, Math.max(bounds.minY, body.y)),
}, body);

const hasCoveredMovableToken = (occupants) => (
  occupants.some((occupant, index) => index > 0 && occupant.canMove)
);

const addLayerOccupants = (occupantsByCell, tokens, aboveFog) => {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token?.tokenId || token.isDragPreview) continue;

    const col = Number(token.col);
    const row = Number(token.row);
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) continue;

    const size = normalizeTokenSizeSquares(token.sizeSquares);
    const occupant = { token, canMove: token.canMove, aboveFog };
    for (let rowOffset = 0; rowOffset < size; rowOffset += 1) {
      for (let colOffset = 0; colOffset < size; colOffset += 1) {
        const key = cellKey(col + colOffset, row + rowOffset);
        const occupants = occupantsByCell.get(key);
        if (Array.isArray(occupants)) occupants.push(occupant);
        else occupantsByCell.set(key, occupants ? [occupants, occupant] : occupant);
      }
    }
  }
};

const forEachRingEdge = (rings, visit) => {
  for (const ring of rings) {
    for (let index = 1; index < ring.length; index += 1) visit(ring[index - 1], ring[index]);
  }
};

const addEdgeBodyIntersectionHeights = (heights, [x, y], dx, dy, lengthSquared, body) => {
  const centerX = body.x - x;
  const centerY = body.y - y;
  const cross = dx * centerY - dy * centerX;
  const discriminant = body.radius ** 2 * lengthSquared - cross ** 2;
  if (discriminant < 0) return;

  const projection = dx * centerX + dy * centerY;
  const offset = Math.sqrt(discriminant);
  for (const t of [(projection - offset) / lengthSquared, (projection + offset) / lengthSquared]) {
    if (t > 0 && t < 1) heights.add(y + t * dy);
  }
};

const addBodyIntersectionHeights = (heights, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= Math.abs(a.radius - b.radius) || distance >= a.radius + b.radius) return;

  const along = (a.radius ** 2 - b.radius ** 2 + distance ** 2) / (2 * distance);
  const y = a.y + along * dy / distance;
  const offsetY = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2)) * dx / distance;
  heights.add(y - offsetY);
  heights.add(y + offsetY);
};

const visitStackPoints = (rings, occupants, visit) => {
  const bodies = [];
  for (const { body } of occupants) {
    if (!bodies.some(({ x, y, radius }) => x === body.x && y === body.y && radius === body.radius)) bodies.push(body);
  }

  // Between consecutive vertices, extrema and intersections, the horizontal
  // order of the polygon edges and circular arcs stays fixed.
  const heights = new Set();
  let top = Infinity;
  let bottom = -Infinity;
  forEachRingEdge(rings, (start, end) => {
    const dy = end[1] - start[1];
    const dx = end[0] - start[0];
    const lengthSquared = dx ** 2 + dy ** 2;
    heights.add(start[1]);
    top = Math.min(top, start[1]);
    bottom = Math.max(bottom, start[1]);
    if (dy) {
      for (const body of bodies) addEdgeBodyIntersectionHeights(heights, start, dx, dy, lengthSquared, body);
    }
  });
  for (const [index, body] of bodies.entries()) {
    heights.add(body.y - body.radius);
    heights.add(body.y + body.radius);
    for (let other = 0; other < index; other += 1) addBodyIntersectionHeights(heights, body, bodies[other]);
  }

  const sortedHeights = [...heights].filter((y) => y >= top && y <= bottom).sort((a, b) => a - b);
  for (let index = 1; index < sortedHeights.length; index += 1) {
    const y = (sortedHeights[index - 1] + sortedHeights[index]) / 2;
    const polygonCrossings = [];
    forEachRingEdge(rings, ([x1, y1], [x2, y2]) => {
      if ((y1 > y) !== (y2 > y)) polygonCrossings.push(x1 + ((x2 - x1) * (y - y1)) / (y2 - y1));
    });
    polygonCrossings.sort((a, b) => a - b);

    const bodyCrossings = [];
    for (const body of bodies) {
      const halfWidthSquared = body.radius ** 2 - (y - body.y) ** 2;
      if (halfWidthSquared > 0) {
        const halfWidth = Math.sqrt(halfWidthSquared);
        bodyCrossings.push(body.x - halfWidth, body.x + halfWidth);
      }
    }
    bodyCrossings.sort((a, b) => a - b);
    for (let next = 1; next < polygonCrossings.length; next += 2) {
      const left = polygonCrossings[next - 1];
      const right = polygonCrossings[next];
      const crossings = [left, ...bodyCrossings.filter((x) => x > left && x < right), right];
      for (let span = 1; span < crossings.length; span += 1) {
        if (crossings[span - 1] < crossings[span] && visit({ x: (crossings[span - 1] + crossings[span]) / 2, y })) return;
      }
    }
  }
};

const polygonContainsPoint = ({ polygon, bounds }, point) => (
  point.x > bounds.minX && point.x < bounds.maxX
  && point.y > bounds.minY && point.y < bounds.maxY
  && pointIsInsideFogPolygon(point, polygon)
);

const polygonMayCoverCell = (entry, cellBounds, center) => {
  if (!boundsOverlap(entry.bounds, cellBounds)) return false;

  // When the center is hidden, the polygon needs an edge inside the cell.
  entry.edgeBounds ||= entry.polygon.flatMap((ring) => ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length];
    return {
      minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y),
    };
  }));
  return entry.edgeBounds.some((edge) => boundsOverlap(edge, cellBounds)) || polygonContainsPoint(entry, center);
};

const findStackInCell = (center, size, occupants, polygons) => {
  const members = new Set();
  let anchor = null;
  const needsSearch = (candidates) => hasCoveredMovableToken(candidates)
    && candidates.some((occupant) => !members.has(occupant));
  const considerPoint = (point, candidates, polygon) => {
    const visible = candidates.filter(({ body }) => pointHitsBody(point, body));
    if (hasCoveredMovableToken(visible) && (!polygon || pointIsInsideFogPolygon(point, polygon))) {
      // Separate parts of a cell may expose different tokens under the same cover.
      anchor ??= point;
      for (const occupant of visible) members.add(occupant);
    }
    return candidates.every((occupant) => members.has(occupant));
  };

  const exposed = !polygons || polygons.some((entry) => polygonContainsPoint(entry, center));
  const unrestricted = polygons ? occupants.filter(({ aboveFog }) => aboveFog) : occupants;
  if (considerPoint(center, exposed ? occupants : unrestricted) && exposed) return { anchor, occupants };

  const halfSize = size / 2;
  const left = center.x - halfSize;
  const right = center.x + halfSize;
  const top = center.y - halfSize;
  const bottom = center.y + halfSize;
  const cellBounds = { minX: left, maxX: right, minY: top, maxY: bottom };
  const cellPolygon = [[[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]];
  const search = (candidates, polygon, rings) => {
    if (!needsSearch(candidates)) return;
    visitStackPoints(rings, candidates, (point) => considerPoint(point, candidates, polygon));
  };

  search(unrestricted.filter(({ body }) => bodyOverlapsBounds(body, cellBounds)), null, cellPolygon);
  for (const entry of polygons || []) {
    if (members.size === occupants.length) break;
    if (!polygonMayCoverCell(entry, cellBounds, center)) continue;
    const { bounds, polygon } = entry;
    const openingBounds = {
      minX: Math.max(left, bounds.minX), maxX: Math.min(right, bounds.maxX),
      minY: Math.max(top, bounds.minY), maxY: Math.min(bottom, bounds.maxY),
    };
    const candidates = occupants.filter(({ body }) => bodyOverlapsBounds(body, openingBounds));
    if (!needsSearch(candidates)) continue;

    entry.clippingPolygon ||= polygon.map((ring) => ring.map(({ x, y }) => [x, y]));
    let clippedPolygons;
    try {
      clippedPolygons = polygonClipping.intersection(entry.clippingPolygon, cellPolygon);
    } catch {
      // If clipping fails, leave this opening unmarked.
      continue;
    }
    for (const rings of clippedPolygons) search(candidates, polygon, rings);
  }
  return anchor ? { anchor, occupants: occupants.filter((occupant) => members.has(occupant)) } : null;
};

const assignStackBadges = (cells) => {
  for (const [key, cell] of cells) {
    if (cell.badgeCellKey) continue;

    cell.badgeCellKey = key;
    const pending = [cell];
    while (pending.length) {
      const { col, row } = pending.pop();
      for (const [colOffset, rowOffset] of neighbors) {
        const neighbor = cells.get(cellKey(col + colOffset, row + rowOffset));
        if (
          !neighbor || neighbor.badgeCellKey || neighbor.tokenIds.length !== cell.tokenIds.length
          || !neighbor.tokenIds.every((id, index) => id === cell.tokenIds[index])
        ) continue;

        neighbor.badgeCellKey = key;
        neighbor.anchor = null;
        pending.push(neighbor);
      }
    }
  }
};

export const buildTokenStackCells = ({
  belowFogTokens = [],
  aboveFogTokens = [],
  grid,
  fogOfWar,
  isFogViewerManager = false,
} = {}) => {
  const occupantsByCell = new Map();
  addLayerOccupants(occupantsByCell, aboveFogTokens, true);
  addLayerOccupants(occupantsByCell, belowFogTokens, false);

  const cells = new Map();
  const isFogRestricted = fogOfWar && !isFogViewerManager;
  let visiblePolygons;
  for (const [key, occupants] of occupantsByCell) {
    if (!Array.isArray(occupants) || !hasCoveredMovableToken(occupants)) continue;

    const { col, row } = decodeFogCellKey(key);
    const { x, y, size } = getGridCellPositionPx({ col, row }, grid, 'center');
    let polygons;
    if (isFogRestricted && occupants.some((occupant) => !occupant.aboveFog)) {
      visiblePolygons ||= buildCurrentVisiblePolygons(fogOfWar).map((polygon) => ({
        polygon,
        bounds: getFogPolygonBounds([[polygon[0]]]),
      }));
      polygons = visiblePolygons;
    }

    for (const occupant of occupants) occupant.body ||= getTokenBody(occupant.token, grid);
    const stack = findStackInCell({ x, y }, size, occupants, polygons);
    if (!stack) continue;
    const tokenIds = stack.occupants.map(({ token }) => token.tokenId);
    cells.set(key, { col, row, tokenIds, anchor: stack.anchor, badgeCellKey: null });
  }

  assignStackBadges(cells);
  return cells;
};

export const isTokenStackPointVisible = ({
  point,
  token,
  grid,
  aboveFogTokens = [],
  fogOfWar,
  isFogViewerManager = false,
} = {}) => {
  if (!token || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)
    || !pointHitsBody(point, getTokenBody(token, grid))) return false;
  return !fogOfWar || isFogViewerManager
    || aboveFogTokens.some(({ tokenId }) => tokenId === token.tokenId)
    || buildCurrentVisiblePolygons(fogOfWar).some((polygon) => pointIsInsideFogPolygon(point, polygon));
};
