export function computeValue(expr, userParams) {
  if (!expr) return null;
  let formula = expr;
  // Recursively replace all MAX(...) and MIN(...) with their computed values
  const fnReplacer = (fn, mathFn) => {
    // Regex to match fn(...), non-greedy for nested functions
    const regex = new RegExp(`${fn}\\(([^()]*?(?:\\([^()]*\\)[^()]*?)*?)\\)`, 'gi');
    while (regex.test(formula)) {
      formula = formula.replace(regex, (match, inner) => {
        // Split by ; or ,
        const parts = inner.split(/[;,]/).map(p => computeValue(p.trim(), userParams));
        return mathFn(...parts);
      });
    }
  };
  fnReplacer('MAX', Math.max);
  fnReplacer('MIN', Math.min);
  // Substitute each parameter name with its Tot value
  const replaced = formula.replace(/\b([A-Za-z]+)\b/g, (_, varName) => {
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