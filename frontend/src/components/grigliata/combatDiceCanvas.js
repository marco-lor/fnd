/* Numbered convex meshes projected into a 2D canvas, adapted from the Grigliata tray prototype. */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (v, k) => v.map(n => n * k);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const add = (a, b) => a.map((n, i) => n + b[i]);
const unit = v => scale(v, 1 / Math.hypot(...v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = points => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
const TAU = 2 * Math.PI;

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
  let points;
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
  if (!cache.has(sides)) cache.set(sides, makeMesh(sides));
  return cache.get(sides);
}

function spinMatrix(x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return v => [
    c * e * v[0] + (b * d * e - a * f) * v[1] + (a * d * e + b * f) * v[2],
    c * f * v[0] + (b * d * f + a * e) * v[1] + (a * d * f - b * e) * v[2],
    -d * v[0] + b * c * v[1] + a * c * v[2],
  ];
}

function path(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

// The selected face supplies the final local coordinate frame. All the numbers
// stay attached to their own faces throughout the throw, including on resize.
function drawSolid(ctx, die, pose, x, y, size, hue, numbered) {
  const faces = mesh(die.sides);
  const front = faces.find(face => face.number === die.value);
  const rotate = spinMatrix(...pose);
  const orient = v => rotate([dot(v, front.east), dot(v, front.north), dot(v, front.normal)]);
  const project = v => {
    const [dx, dy, dz] = orient(v);
    const depth = 4.8 / (4.8 - dz);
    return [x + size * dx * depth, y - size * dy * depth];
  };
  const light = [-0.44, 0.65, 0.62];
  const visible = faces.map(face => ({ face, normal: orient(face.normal), center: orient(face.center) }))
    .filter(({ normal, center }) => dot(normal, sub([0, 0, 4.8], center)) > 0)
    .sort((a, b) => a.center[2] - b.center[2]);
  for (const { face, normal } of visible) {
    const pts = face.vertices.map(project);
    const center = project(face.center);
    const lit = Math.max(0, dot(normal, light));
    const metal = (level, saturation = 50) => 'hsl(' + hue + ' ' + saturation + '% ' + level + '%)';
    const fill = ctx.createLinearGradient(center[0] - size * 0.5, center[1] - size * 0.7, center[0] + size * 0.6, center[1] + size * 0.8);
    const value = 10 + 29 * lit;
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
    if (!numbered) continue;

    const east = project(add(face.center, scale(face.east, 0.02)));
    const down = project(sub(face.center, scale(face.north, 0.02)));
    const step = size * 0.02;
    ctx.save();
    ctx.transform((east[0] - center[0]) / step, (east[1] - center[1]) / step,
      (down[0] - center[0]) / step, (down[1] - center[1]) / step, center[0], center[1]);
    const mark = die.format ? die.format(face.number) : String(face.number);
    const fontSize = size * face.radius * (mark.length > 1 ? 1.24 : 1.52);
    ctx.font = '600 ' + fontSize + 'px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1, size * 0.022);
    ctx.strokeStyle = metal(13, 45);
    ctx.strokeText(mark, 0, fontSize * 0.045);
    ctx.fillStyle = metal(71 + lit * 25, 64);
    ctx.fillText(mark, 0, fontSize * 0.045);
    if (mark === '6' || mark === '9') ctx.fillRect(-fontSize * 0.12, fontSize * 0.46, fontSize * 0.24, Math.max(0.8, size * 0.017));
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
      drawSolid(ctx, die, pose, x, ground - size * 0.97 - lift, size, hue + i * 3, !pending);
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
