import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveThemeCanvas } from '../src/theme/theme-settings.js';

test('switches untouched default canvas colors between light and dark themes', () => {
  assert.deepEqual(resolveThemeCanvas({ background: '#F6F8FC', plotBackground: '#FFFFFF' }, 'light', 'dark'), {
    background: '#090B14', plotBackground: '#0E1220',
  });
});

test('preserves deliberately customized canvas colors across theme changes', () => {
  assert.deepEqual(resolveThemeCanvas({ background: '#FFF8E8', plotBackground: '#FAFAFA' }, 'light', 'dark'), {
    background: '#FFF8E8', plotBackground: '#FAFAFA',
  });
});
