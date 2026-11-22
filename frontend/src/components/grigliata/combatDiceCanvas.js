/* Numbered convex meshes projected into a 2D canvas, adapted from the Grigliata tray prototype. */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (v, k) => v.map(n => n * k);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const add = (a, b) => a.map((n, i) => n + b[i]);
const unit = v => scale(v, 1 / Math.hypot(...v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = points => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
const TAU = 2 * Math.PI;
const STANDARD = new Set([4, 6, 8, 10, 12, 20]);

function hull(points) {
  const faces = new Map();
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const a = points[i];
        const perpendicular = cross(sub(points[j], a), sub(points[k], a));
        if (Math.hypot(...perpendicular) < 0.00001) continue;
        let normal = unit(perpendicular);
        if (dot(normal, a) < 0) normal = scale(normal, -1);
        const distances = points.map(p => dot(normal, sub(p, a)));
        if (distances.some(n => n > 0.00001)) continue;
        const indices = distances.flatMap((n, index) => Math.abs(n) < 0.00001 ? [index] : []);
        const key = indices.join(',');
        if (faces.has(key)) continue;
        const center = mean(indices.map(index => points[index]));
        const east = unit(cross(Math.abs(normal[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0], normal));
        const north = cross(normal, east);
        const angle = index => Math.atan2(dot(sub(points[index], center), north), dot(sub(points[index], center), east));
        const vertices = indices.sort((l, r) => angle(l) - angle(r)).map(index => points[index]);
        const radius = Math.min(...vertices.map((p, n) => {
          const edge = unit(sub(vertices[(n + 1) % vertices.length], p));
          return Math.hypot(...cross(edge, sub(center, p)));
        }));
        faces.set(key, { vertices, center, normal, east, north, radius });
      }
    }
  }
  return [...faces.values()];
}

function dual(points) {
  return hull(points).map(face => scale(face.normal, 1 / dot(face.center, face.normal)));
}

function makeMesh(sides) {
  const signs = [-1, 1];
  // Any other die is a flat octagonal counter, unlike every numbered solid: its cap carries the value.
  let points = [-0.4, 0.4].flatMap(z => Array.from({ length: 8 }, (_, i) => [
    Math.cos(TAU * (i + 0.5) / 8), Math.sin(TAU * (i + 0.5) / 8), z,
  ]));
  if (sides === 4) points = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  if (sides === 6) points = signs.flatMap(x => signs.flatMap(y => signs.map(z => [x, y, z])));
  if (sides === 8) points = signs.flatMap(n => [[n, 0, 0], [0, n, 0], [0, 0, n]]);
  if (sides === 10) {
    const rings = Array.from({ length: 10 }, (_, i) => [
      Math.cos(TAU * i / 10), i % 2 ? 0.68 : -0.68, Math.sin(TAU * i / 10),
    ]);
    points = dual(rings);
  }
  if (sides === 12 || sides === 20) {
    const phi = (1 + Math.sqrt(5)) / 2;
    const ico = signs.flatMap(a => signs.flatMap(b => [[0, a, b * phi], [a, b * phi, 0], [b * phi, 0, a]]));
    points = sides === 12 ? dual(ico) : ico;
  }
  const radius = Math.max(...points.map(p => Math.hypot(...p)));
  const faces = hull(points.map(p => scale(p, 1 / radius)));
  if (!STANDARD.has(sides)) {
    for (const face of faces) face.cap = face.normal[2] > 0.99;
    return faces;
  }
  // Opposite faces carry complementary numbers on centrally symmetric solids.
  let number = 1;
  for (const face of faces) {
    if (face.number) continue;
    face.number = number++;
    const opposite = faces.find(other => !other.number && dot(face.normal, other.normal) < -0.99999);
    if (opposite) opposite.number = sides + 1 - face.number;
  }
  return faces;
}

const cache = new Map();
export function mesh(sides) {
  const key = STANDARD.has(sides) ? sides : 0;
  if (!cache.has(key)) cache.set(key, makeMesh(key));
  return cache.get(key);
}

function rotation(x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return [
    [c * e, b * d * e - a * f, a * d * e + b * f],
    [c * f, b * d * f + a * e, a * d * f - b * e],
    [-d, b * c, a * c],
  ];
}

const product = (m, n) => m.map(row => [0, 1, 2].map(j => row[0] * n[0][j] + row[1] * n[1][j] + row[2] * n[2][j]));
const inverseRotation = matrix => matrix[0].map((_, column) => matrix.map(row => row[column]));
const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// The front face (the shown number, or a counter's cap) supplies the solid's local frame: at rest it faces the viewer.
function poseMatrix(die, pose) {
  const faces = mesh(die.sides);
  const shown = die.face ?? die.value;
  const front = STANDARD.has(die.sides) ? faces.find(face => face.number === shown) : faces.find(face => face.cap);
  return product(rotation(...pose), [front.east, front.north, front.normal]);
}

// Rotations blend through quaternions, so a tumbling piece can turn onto its value without a jump.
function quaternionOf([[a, b, c], [d, e, f], [g, h, i]]) {
  const trace = a + e + i;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [0.25 / s, (h - f) * s, (c - g) * s, (d - b) * s];
  }
  if (a > e && a > i) {
    const s = 2 * Math.sqrt(1 + a - e - i);
    return [(h - f) / s, 0.25 * s, (b + d) / s, (c + g) / s];
  }
  if (e > i) {
    const s = 2 * Math.sqrt(1 + e - a - i);
    return [(c - g) / s, (b + d) / s, 0.25 * s, (f + h) / s];
  }
  const s = 2 * Math.sqrt(1 + i - a - e);
  return [(d - b) / s, (c + g) / s, (f + h) / s, 0.25 * s];
}

function matrixOf([w, x, y, z]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function blend(m, n, k) {
  const p = quaternionOf(m);
  let q = quaternionOf(n);
  let cos = p.reduce((sum, value, i) => sum + value * q[i], 0);
  if (cos < 0) {
    q = q.map(value => -value);
    cos = -cos;
  }
  if (cos > 0.9995) {
    const mixed = p.map((value, i) => value + (q[i] - value) * k);
    return matrixOf(scale(mixed, 1 / Math.hypot(...mixed)));
  }
  const angle = Math.acos(cos);
  const s = Math.sin(angle);
  return matrixOf(p.map((value, i) => (value * Math.sin((1 - k) * angle) + q[i] * Math.sin(k * angle)) / s));
}

function path(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

const EYE = 4.8;
const LIGHT = [-0.44, 0.65, 0.62];
const perspective = (matrix, v) => {
  const [dx, dy, dz] = matrix.map(row => dot(row, v));
  const depth = EYE / (EYE - dz);
  return [dx * depth, -dy * depth];
};

// On the map, numerals smaller than this (CSS px) are left out: the tray lists every face as text.
const MIN_NUMERAL = 6;

// The matrix places the solid. All the numbers stay attached to their own faces throughout the throw, including on
// resize. A lite solid (a dense pool in motion) is one flat fill and its edges per face.
function drawSolid(ctx, die, matrix, x, y, size, hue, numbered, lite = false, minNumeral = 0) {
  const faces = mesh(die.sides);
  const counter = !STANDARD.has(die.sides);
  const orient = v => matrix.map(row => dot(row, v));
  const project = v => {
    const [px, py] = perspective(matrix, v);
    return [x + size * px, y + size * py];
  };
  const visible = faces.map(face => ({ face, normal: orient(face.normal), center: orient(face.center) }))
    .filter(({ normal, center }) => dot(normal, sub([0, 0, EYE], center)) > 0)
    .sort((a, b) => a.center[2] - b.center[2]);
  for (const { face, normal } of visible) {
    const pts = face.vertices.map(project);
    const lit = Math.max(0, dot(normal, LIGHT));
    // A counter is a neutral piece: the kind's hue only tints it.
    const metal = (level, saturation = 50) => 'hsl(' + hue + ' ' + (counter ? saturation / 4 : saturation) + '% ' + level + '%)';
    const value = 10 + 29 * lit;
    if (lite) {
      path(ctx, pts);
      ctx.fillStyle = metal(value + 6);
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, size * 0.027);
      ctx.strokeStyle = metal(39 + lit * 43, 47);
      ctx.lineJoin = 'round';
      ctx.stroke();
      continue;
    }
    const center = project(face.center);
    const fill = ctx.createLinearGradient(center[0] - size * 0.5, center[1] - size * 0.7, center[0] + size * 0.6, center[1] + size * 0.8);
    fill.addColorStop(0, metal(value + 15));
    fill.addColorStop(0.46, metal(value + 2));
    fill.addColorStop(0.59, metal(value + 6));
    fill.addColorStop(1, metal(value - 5));
    path(ctx, pts);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, size * 0.027);
    ctx.strokeStyle = metal(39 + lit * 43, 47);
    ctx.lineJoin = 'round';
    ctx.stroke();
    path(ctx, pts.map(([px, py]) => [center[0] + (px - center[0]) * 0.88, center[1] + (py - center[1]) * 0.88]));
    ctx.lineWidth = Math.max(0.55, size * 0.009);
    ctx.strokeStyle = metal(value + 23, 39);
    ctx.stroke();
    if (!numbered || (counter && !face.cap)) continue;

    const east = project(add(face.center, scale(face.east, 0.02)));
    const down = project(sub(face.center, scale(face.north, 0.02)));
    const step = size * 0.02;
    ctx.save();
    ctx.transform((east[0] - center[0]) / step, (east[1] - center[1]) / step,
      (down[0] - center[0]) / step, (down[1] - center[1]) / step, center[0], center[1]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1, size * 0.022);
    const label = (text, fontSize, dx, dy) => {
      ctx.font = '600 ' + fontSize + 'px Georgia, serif';
      ctx.strokeStyle = metal(13, 45);
      ctx.strokeText(text, dx, dy);
      ctx.fillStyle = metal(71 + lit * 25, 64);
      ctx.fillText(text, dx, dy);
    };
    const sign = die.sign === -1 ? '−' : '';
    const radius = size * face.radius;
    if (counter) {
      // The value and the die type, so a d62 never reads as a standard die; both stay inside the cap.
      const mark = sign + die.value;
      const fontSize = radius * (mark.length < 3 ? 0.95 : mark.length < 4 ? 0.74 : 0.58);
      if (fontSize >= minNumeral) label(mark, fontSize, 0, -radius * 0.12);
      if (fontSize >= minNumeral && radius * 0.34 >= 6) label('d' + die.sides, radius * 0.34, 0, radius * 0.56);
    } else {
      const mark = die.format ? die.format(face.number) : String(face.number);
      const fontSize = radius * (sign.length + mark.length > 1 ? 1.24 : 1.52);
      // A subtracted die carries a minus before the number of every face; the pair stays centred on the face.
      const shift = sign ? fontSize * 0.3 : 0;
      if (fontSize >= minNumeral) {
        label(mark, fontSize, shift, fontSize * 0.045);
        if (sign) label(sign, fontSize, -fontSize * 0.29 * mark.length, fontSize * 0.045);
        if (mark === '6' || mark === '9') ctx.fillRect(shift - fontSize * 0.12, fontSize * 0.46, fontSize * 0.24, Math.max(0.8, size * 0.017));
      }
    }
    ctx.restore();
  }
}

// Integrate the flight and ground contacts at a fixed time step. Horizontal
// friction and inelastic bounces damp the spin before the final face settles.
function trajectory(index, impulse) {
  const dt = 1 / 90;
  let x = -0.58 * impulse.direction, vx = (2.25 + 0.5 * index) * impulse.direction * impulse.power;
  let height = 0.07, vy = 2.9 * impulse.power, spin = 0, omega = 12 + 2.5 * index;
  const frames = [];
  for (let i = 0; i < 156; i++) {
    frames.push({ x, height, spin });
    vy -= 12 * dt;
    height += vy * dt;
    if (height < 0) {
      height = 0;
      vy = Math.abs(vy) < 0.34 ? 0 : -vy * 0.46;
      vx *= 0.92;
      omega *= 0.90;
    }
    x += vx * dt;
    if (Math.abs(x) > 0.93) { x = Math.sign(x) * 0.93; vx *= -0.60; }
    spin += omega * dt;
  }
  return frames;
}

// Two ten-sided dice represent a percentile die, with 00 + 0 reading as 100.
export function percentileSolids({ value }) {
  return [
    { sides: 10, value: Math.floor(value % 100 / 10) || 10, format: n => String((n % 10) * 10).padStart(2, '0') },
    { sides: 10, value: value % 10 || 10, format: n => String(n % 10) },
  ];
}

const DURATION = 1400;
const BUTTON_GESTURE = { direction: 1, power: 1 };

// The defense receipt and the throw handle's preview: a few standard dice, thrown once their faces are known.
export function animateCombatDice(canvas, rolls, hue, { gesture = BUTTON_GESTURE, preview = false, pending = false, startedAt = performance.now() } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const dice = rolls.flatMap(die => die.sides === 100 ? percentileSolids(die) : [die]);
  const paths = preview ? [] : dice.map((_, index) => trajectory(index, gesture));
  const start = startedAt - (preview ? DURATION : 0);
  let frame;
  let last = -Infinity;
  const draw = now => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(w * dpr);
    const height = Math.round(h * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const elapsed = Math.max(0, now - start);
    const t = Math.min(pending ? 0.7 : 1, elapsed / DURATION);
    const count = dice.length;
    const columns = count <= 4 ? count : Math.min(count, Math.max(3, Math.min(6, Math.floor(w / 76))));
    const rows = Math.ceil(count / columns);
    const rowHeight = h / rows;
    const size = Math.min(rowHeight * 0.33, w / (columns * 2.8 + 0.8));
    const blend = Math.min(1, (1 - t) / 0.29);
    const ease = blend * blend * (3 - 2 * blend);
    dice.forEach((die, i) => {
      const path = paths[i];
      const step = path?.[Math.floor(t * (path.length - 1))];
      const row = Math.floor(i / columns);
      const columnsInRow = Math.min(columns, count - row * columns);
      const homeX = w / 2 + (i % columns - (columnsInRow - 1) / 2) * size * 2.55;
      const x = Math.max(size, Math.min(w - size, homeX + (step?.x ?? 0) * w * 0.21 * ease));
      const ground = rowHeight * (row + 0.57) + size * 0.57 + (i % 2) * 3;
      const lift = (step?.height ?? 0) * rowHeight * 0.52;
      ctx.save();
      ctx.translate(x, ground);
      ctx.scale(size * (1.06 + lift / rowHeight), size * 0.21);
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      shadow.addColorStop(0, 'rgba(0,0,0,' + (0.69 - Math.min(0.4, lift / rowHeight)) + ')');
      shadow.addColorStop(1, 'transparent');
      ctx.fillStyle = shadow;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
      const spin = step ? step.spin - path[path.length - 1].spin + (pending ? Math.max(0, elapsed - DURATION * 0.7) * 0.004 : 0) : 0;
      const pose = [-0.33 + spin * 0.88, -0.26 + spin * (i % 2 ? -1 : 1.26), -0.1 + spin * 0.48];
      drawSolid(ctx, die, poseMatrix(die, pose), x, ground - size * 0.97 - lift, size, hue + i * 3, !pending);
    });
  };
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => draw(performance.now()));
  resize?.observe(canvas);
  const tick = now => {
    const done = !pending && now - start >= DURATION;
    if (done || now - last >= 30) {
      draw(now);
      last = now;
    }
    if (!done) frame = requestAnimationFrame(tick);
  };
  const now = performance.now();
  draw(now);
  if (!preview && (pending || now - start < DURATION)) frame = requestAnimationFrame(tick);
  return () => {
    if (frame != null) cancelAnimationFrame(frame);
    resize?.disconnect();
  };
}

/* The map throw. Every piece keeps its own lane of the surface from birth to rest, so the pieces of a row never
   touch; its state is a pure function of the time and of the throw (planned pool, receipt, release, receipt time). */
const BIRTH = 160;        // a piece fades and drops into its lane
const STAGGER = 40;       // between neighbours' births, in four steps
const MIN_TUMBLE = 900;   // an instant reply still reads as a roll
const REFLOW = 260;       // pieces glide to the receipt's lanes
const JOIN_TUMBLE = 750;  // a die only the receipt holds tumbles this long before the group lands
const SETTLE = 500;       // the spin dies out and the bodies line up
const LEAVE = 200;        // a planned piece the receipt does not hold fades out
const TUMBLE = 0.0105;    // rad/ms of a steady tumble
const SPIN_EASE = 400;    // ms for the throw's extra spin to fade into the tumble
const REST = [-0.33, -0.26, -0.1];
const MAX_PITCH = 96;     // the largest cell a die gets
const PAD = 0.2;          // margin around the group, in cells
const DIE = 0.36;         // die size per cell: a body spans at most 0.74 of its lane

const clamp01 = u => Math.min(1, Math.max(0, u));
const smooth = u => u * u * (3 - 2 * u);
const lerp = (a, b, k) => a + (b - a) * k;

// The grid with the largest cells (up to MAX_PITCH) for any pool the server rolls, up to 320 solids; among grids
// of that size, as few rows as eight per row allow. Every row is centred, so the group is centred on the surface.
export function combatDiceLayout(count, width, height) {
  let best = { columns: 0, rows: 0, pitch: 0 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const pitch = Math.max(0, Math.min(MAX_PITCH, width / (columns + PAD), height / (rows + PAD)));
    if (pitch > best.pitch + 0.01 || (pitch > best.pitch - 0.01 && rows < best.rows && columns <= 8)) best = { columns, rows, pitch };
  }
  const { columns, rows, pitch } = best;
  const slots = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns);
    const inRow = Math.min(columns, count - row * columns);
    return { x: width / 2 + (i % columns - (inRow - 1) / 2) * pitch, y: height / 2 + (row - (rows - 1) / 2) * pitch };
  });
  return { columns, rows, pitch, size: pitch * DIE, slots };
}

// The projected outline of a solid, in die sizes around its centre.
function outline(die, matrix) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const face of mesh(die.sides)) {
    for (const vertex of face.vertices) {
      const [x, y] = perspective(matrix, vertex);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { cx: (left + right) / 2, cy: (top + bottom) / 2, hw: (right - left) / 2, hh: (bottom - top) / 2 };
}

const rests = new Map();
function rest(die) {
  const key = STANDARD.has(die.sides) ? die.sides + ':' + die.face : 'counter';
  if (!rests.has(key)) {
    const matrix = poseMatrix(die, REST);
    rests.set(key, { matrix, box: outline(die, matrix) });
  }
  return rests.get(key);
}

// The body of a frame's piece, in canvas pixels.
export function combatPieceBox({ die, matrix, x, y, size }) {
  const { cx, cy, hw, hh } = outline(die, matrix);
  return { left: x + (cx - hw) * size, right: x + (cx + hw) * size, top: y + (cy - hh) * size, bottom: y + (cy + hh) * size };
}

// A percentile die is thrown as two ten-sided dice, tens and units.
const solids = die => (die.sides === 100
  ? (die.value ? percentileSolids(die) : [{ sides: 10 }, { sides: 10 }]).map(solid => ({ ...solid, of: 100, sign: die.sign }))
  : [{ ...die, of: die.sides }]);

// `planned` is shown from the release; `receipt` (the server's faces) is null until the reply. A throw that has
// neither a release nor a receipt time is shown at rest. `paintedAt`, the throw's first painted frame, holds a
// throw whose renderer arrived late: no piece is born before it, and the group lands a whole roll after it.
export function combatThrowModel({ planned = [], receipt = null, releasedAt = -Infinity, resolvedAt = -Infinity,
  paintedAt = null, direction = 1, power = 1 } = {}) {
  const resolved = Array.isArray(receipt);
  const shownAt = Number.isFinite(releasedAt) && Number.isFinite(paintedAt) ? Math.max(releasedAt, paintedAt) : releasedAt;
  // Before the reply a die has no value: any face leads its tumble, and none is numbered.
  const pieces = planned.flatMap(solids).map((die, index) => ({
    tumble: { ...die, face: 1 + index * 7 % die.sides }, die: null, from: index, to: null,
    bornAt: shownAt + STAGGER * (index % 4),
  }));
  const before = pieces.length;
  let after = before;
  if (resolved) {
    const dice = receipt.flatMap(solids);
    after = dice.length;
    // Receipt dice take the planned pieces of their kind in order; any other is thrown in at the receipt.
    dice.forEach((die, to) => {
      const known = { ...die, face: die.value };
      const piece = pieces.find(item => item.from !== null && item.to === null && item.tumble.of === die.of);
      if (piece) Object.assign(piece, { die: known, to });
      else pieces.push({ tumble: known, die: known, from: null, to, bornAt: null });
    });
  }
  const leaving = resolved && pieces.some(piece => piece.from !== null && piece.to === null);
  const moving = pieces.some(piece => piece.from !== null && piece.to !== null && (before !== after || piece.from !== piece.to));
  // Leavers fade first, the others then glide to their lanes, and only then are the dice no one planned born.
  const reflowAt = resolved ? resolvedAt + (leaving ? LEAVE : 0) : Infinity;
  const joinAt = reflowAt + (moving ? REFLOW : 0);
  let joined = 0;
  for (const piece of pieces) if (piece.from === null) piece.bornAt = Math.max(joinAt, shownAt) + STAGGER * (joined++ % 4);
  // One landing for the whole group, so every die tumbles until all of them settle together.
  const landAt = resolved ? Math.max(resolvedAt, joinAt, shownAt + MIN_TUMBLE, ...pieces.filter(piece => piece.to !== null)
    .map(piece => piece.bornAt + (piece.from === null ? JOIN_TUMBLE : MIN_TUMBLE))) : Infinity;
  const impulse = { direction: direction < 0 ? -1 : 1, power: Math.min(1.25, Math.max(0.6, Number(power) || 1)) };
  if (Number.isFinite(landAt)) {
    pieces.forEach((piece, seed) => {
      if (piece.to === null) return;
      const { turned, speed } = spin(piece, seed, impulse.power, landAt);
      const end = posed(piece.tumble, seed, impulse.direction * (turned + speed * SETTLE / 2));
      // Fix one path onto the server face. Choosing a fresh shortest rotation every frame
      // can reverse that path midway and visibly flip the die as it lands.
      const correction = product(rest(piece.die).matrix, inverseRotation(end));
      piece.landing = { turned, speed, correction };
    });
  }
  return {
    pieces, resolved, before, after, resolvedAt: resolved ? resolvedAt : Infinity, reflowAt, landAt, doneAt: landAt + SETTLE,
    ...impulse,
  };
}

// Radians turned since birth, and the speed: a quick throw easing into a steady tumble.
function spin(piece, seed, power, t) {
  const age = Math.max(0, t - piece.bornAt);
  const omega = TUMBLE * (1 + 0.15 * (seed % 3));
  const kick = omega * 1.2 * power * Math.exp(-age / SPIN_EASE);
  return { turned: omega * age + omega * 1.2 * power * SPIN_EASE - kick * SPIN_EASE, speed: omega + kick };
}

const posed = (die, seed, turn) => poseMatrix(die, [REST[0] + turn * 0.88, REST[1] + turn * (seed % 2 ? -1 : 1.26), REST[2] + turn * 0.48]);

// Every visible piece at time t on a surface of width × height CSS pixels.
export function combatThrowFrame(model, t, width, height) {
  const { pieces, resolved, resolvedAt, landAt, direction, power } = model;
  const from = combatDiceLayout(model.before, width, height);
  const to = combatDiceLayout(model.after, width, height);
  const reflow = smooth(clamp01((t - model.reflowAt) / REFLOW));
  const settle = clamp01((t - landAt) / SETTLE);
  const ease = smooth(settle);
  // Share the horizontal travel so neighbouring dice keep their spacing. Use the free map area
  // on each side of the whole pool, then draw the scattered lanes back together at rest.
  const entry = model.before ? from : to;
  const exit = model.after ? to : from;
  const runway = layout => Math.min(1.65 * layout.pitch, Math.max(0, (width - layout.columns * layout.pitch) / 2));
  const spread = layout => Math.min((layout.rows === 1 ? 0.34 : 0.055) * layout.pitch,
    Math.max(0, (height - layout.rows * layout.pitch) / 2));
  const flightAge = Math.max(0, t - (pieces[0]?.bornAt ?? t));
  const progress = 1 - (1 - clamp01(flightAge / 850)) ** 2;
  const travelX = direction * lerp(runway(entry), runway(exit), reflow) * (1.45 * progress - 1) * (1 - ease);
  const spreadY = lerp(spread(entry), spread(exit), reflow) * (1 - ease);
  // Each body at rest is centred in its lane by its real outline, and the bodies together on the surface.
  const union = pieces.filter(piece => piece.to !== null).reduce(([left, top, right, bottom], piece) => {
    const { x, y } = to.slots[piece.to];
    const { hw, hh } = rest(piece.die).box;
    return [Math.min(left, x - hw * to.size), Math.min(top, y - hh * to.size),
      Math.max(right, x + hw * to.size), Math.max(bottom, y + hh * to.size)];
  }, [Infinity, Infinity, -Infinity, -Infinity]);
  const shiftX = Number.isFinite(union[0]) ? (width - union[0] - union[2]) / 2 : 0;
  const shiftY = Number.isFinite(union[1]) ? (height - union[1] - union[3]) / 2 : 0;
  return pieces.flatMap((piece, seed) => {
    const fade = resolved && piece.to === null ? smooth(clamp01((t - resolvedAt) / LEAVE)) : 0;
    const birth = clamp01((t - piece.bornAt) / BIRTH);
    if (fade >= 1 || birth <= 0) return [];
    const a = piece.from === null ? null : from.slots[piece.from];
    const b = piece.to === null ? null : to.slots[piece.to];
    const k = a && b ? reflow : b ? 1 : 0;
    const lane = a && b ? { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) } : a || b;
    const pitch = lerp(a ? from.pitch : to.pitch, b ? to.pitch : from.pitch, k);
    const grow = smooth(birth);
    const size = pitch * DIE * (0.55 + 0.45 * grow) * (1 - 0.3 * fade);
    const landed = settle > 0 && piece.die;
    let matrix;
    if (landed && settle >= 1) matrix = rest(piece.die).matrix;
    else if (landed) {
      // The tumble slows on its own course while the value's face turns toward the viewer.
      const { turned, speed, correction } = piece.landing;
      const course = turned + speed * SETTLE * (settle - settle * settle / 2);
      matrix = product(blend(IDENTITY, correction, ease), posed(piece.tumble, seed, direction * course));
    } else matrix = posed(piece.tumble, seed, direction * spin(piece, seed, power, t).turned);
    const age = t - piece.bornAt - BIRTH;
    const live = Number.isFinite(age) && age > 0 && ease < 1;
    // Thrown from its side of the lane, then a sway and hops that never leave it.
    const sway = Math.max(0, 0.1 * pitch - 2);
    const dx = -direction * sway * (1 - grow)
      + (live ? sway * 0.5 * (1 - ease) * Math.sin(age * 0.004 * (1 + 0.1 * (seed % 4))) : 0);
    const hop = live ? 0.12 * pitch * Math.min(power, 1.1) * (1 - ease) * Math.abs(Math.sin(age * 0.0083 * (1 + 0.1 * (seed % 3)))) : 0;
    const lift = Math.min(Math.max(0, lane.y - 0.38 * pitch), 0.22 * pitch * (1 - grow) + hop) + 0.15 * pitch * fade;
    const box = outline(piece.tumble, matrix);
    const centreX = lane.x + travelX + dx + shiftX * ease;
    const ground = lane.y + (seed % 3 - 1) * spreadY + shiftY * ease;
    return [{
      die: landed ? piece.die : piece.tumble, seed, matrix, size, lift, alpha: grow * (1 - fade),
      x: centreX - box.cx * size, y: ground - box.cy * size - lift, shadowX: centreX, ground: ground + 0.85 * size,
      numbered: Boolean(landed),
    }];
  });
}

// Above this many pieces a motion frame draws lite solids; the frame at rest is always drawn in full.
const LITE_ABOVE = 24;

function paint(ctx, pieces, hue, lite) {
  for (const { shadowX, ground, size, lift, alpha } of pieces) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(shadowX, ground);
    ctx.scale(size * (0.95 + lift / size * 0.25), size * 0.17);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    shadow.addColorStop(0, 'rgba(0,0,0,' + (0.62 - Math.min(0.32, lift / size * 0.3)) + ')');
    shadow.addColorStop(1, 'transparent');
    ctx.fillStyle = shadow;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  for (const piece of [...pieces].sort((p, q) => p.ground - q.ground)) {
    ctx.globalAlpha = piece.alpha;
    // A subtracted die is red from the throw on.
    drawSolid(ctx, piece.die, piece.matrix, piece.x, piece.y, piece.size,
      (piece.die.sign === -1 ? 0 : hue) + (piece.seed % 6) * 3, piece.numbered, lite, MIN_NUMERAL);
  }
  ctx.globalAlpha = 1;
}

// One controller per throw: `update` with the receipt continues the same motion, and once the dice are at rest one
// last frame is drawn and no further frame is requested. A throw with a release is anchored to its first painted
// frame (`scene.paintedAt`, else now), handed to `onPaint` so a remount continues it instead of replaying it.
export function throwCombatDice(canvas, scene, { hue = 35, onSettled, onPaint } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  let current = scene;
  let paintedAt = scene.paintedAt ?? null;
  const build = () => combatThrowModel({ ...current, paintedAt: current.paintedAt ?? paintedAt });
  let model = build();
  let frame = null;
  let last = -Infinity;
  let settled = false;
  let stopped = false;
  const draw = now => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (paintedAt === null && Number.isFinite(current.releasedAt)) {
      paintedAt = now;
      model = build();
      onPaint?.(now);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(w * dpr);
    const height = Math.round(h * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    paint(ctx, combatThrowFrame(model, now, w, h), hue, now < model.doneAt && model.pieces.length > LITE_ABOVE);
    last = now;
    if (!settled && now >= model.doneAt) {
      settled = true;
      onSettled?.();
    }
  };
  const tick = () => {
    frame = null;
    const now = performance.now();
    const done = now >= model.doneAt;
    if (done || now - last >= 30) draw(now);
    if (!done) frame = requestAnimationFrame(tick);
  };
  const play = () => {
    const now = performance.now();
    draw(now);
    if (now < model.doneAt && frame == null) frame = requestAnimationFrame(tick);
  };
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => draw(performance.now()));
  resize?.observe(canvas);
  play();
  return {
    update(next) {
      if (stopped) return;
      current = next;
      model = build();
      settled = false;
      play();
    },
    stop() {
      stopped = true;
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
      resize?.disconnect();
    },
  };
}
