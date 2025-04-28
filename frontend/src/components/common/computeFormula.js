export function computeValue(expr, userParams) {
  if (!expr) return null;
  // Handle MAX(a;b;...)
  if (expr.startsWith('MAX(') && expr.endsWith(')')) {
    const inner = expr.slice(4, -1);
    const parts = inner.split(/[;,]/).map(p => computeValue(p.trim(), userParams));
    return Math.max(...parts);
  }
  // Handle MIN(a;b;...)
  if (expr.startsWith('MIN(') && expr.endsWith(')')) {
    const inner = expr.slice(4, -1);
    const parts = inner.split(/[;,]/).map(p => computeValue(p.trim(), userParams));
    return Math.min(...parts);
  }
  // Substitute each parameter name with its Tot value
  const replaced = expr.replace(/\b([A-Za-z]+)\b/g, (_, varName) => {
    const val = (userParams.Base[varName]?.Tot || 0) + (userParams.Combattimento[varName]?.Tot || 0);
    return `(${val})`;
  });
  try {
    // Evaluate arithmetic expression (+, -, *, /)
    // eslint-disable-next-line no-new-func
    return new Function(`return ${replaced}`)();
  } catch {
    return null;
  }
}