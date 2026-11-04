export const THEME_CANVAS = Object.freeze({
  light: Object.freeze({ background: '#F6F8FC', plotBackground: '#FFFFFF' }),
  dark: Object.freeze({ background: '#090B14', plotBackground: '#0E1220' }),
});

export function resolveThemeCanvas(settings = {}, previousTheme = 'light', nextTheme = 'light') {
  const previous = THEME_CANVAS[previousTheme] ?? THEME_CANVAS.light;
  const next = THEME_CANVAS[nextTheme] ?? THEME_CANVAS.light;
  const normalizedBackground = String(settings.background ?? '').toUpperCase();
  const normalizedPlot = String(settings.plotBackground ?? '').toUpperCase();
  return {
    background: !normalizedBackground || normalizedBackground === previous.background ? next.background : settings.background,
    plotBackground: !normalizedPlot || normalizedPlot === previous.plotBackground ? next.plotBackground : settings.plotBackground,
  };
}
