const reportWebVitals = onPerfEntry => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ onCLS, onINP, onLCP, onTTFB }) => {
      const options = { reportAllChanges: true };
      onCLS(onPerfEntry, options);
      onINP(onPerfEntry, options);
      onLCP(onPerfEntry, options);
      onTTFB(onPerfEntry, options);
    });
  }
};

export default reportWebVitals;
