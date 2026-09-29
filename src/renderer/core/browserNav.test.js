import { describe, it, expect } from 'vitest';
import { normalizeUrl, resolveAddress, navDefaultFor, navEnabled, historyState } from './browserNav.js';

describe('normalizeUrl', () => {
  it('acepta http(s) y agrega https a dominios pelados', () => {
    expect(normalizeUrl('http://a.cl/x')).toBe('http://a.cl/x');
    expect(normalizeUrl('discord.com/app')).toBe('https://discord.com/app');
  });
  it('rechaza lo que no es URL', () => {
    expect(normalizeUrl('hola')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});

describe('resolveAddress', () => {
  it('acepta URL completa', () => {
    expect(resolveAddress('https://netflix.com/browse')).toBe('https://netflix.com/browse');
  });
  it('agrega https a un dominio pelado', () => {
    expect(resolveAddress('discord.com/app')).toBe('https://discord.com/app');
  });
  it('texto con espacios busca en Google', () => {
    expect(resolveAddress('jurisprudencia corte suprema')).toBe(
      'https://www.google.com/search?q=jurisprudencia%20corte%20suprema');
  });
  it('una palabra sin punto busca en Google', () => {
    expect(resolveAddress('netflix')).toBe('https://www.google.com/search?q=netflix');
  });
  it('vacío devuelve null', () => {
    expect(resolveAddress('   ')).toBeNull();
    expect(resolveAddress('')).toBeNull();
    expect(resolveAddress(undefined)).toBeNull();
  });
});

describe('navDefaultFor', () => {
  it('manual enciende, app apaga', () => {
    expect(navDefaultFor('manual')).toBe(true);
    expect(navDefaultFor('app')).toBe(false);
  });
});

describe('navEnabled', () => {
  it('solo true explícito enciende', () => {
    expect(navEnabled({ nav: true })).toBe(true);
    expect(navEnabled({ nav: false })).toBe(false);
    expect(navEnabled({})).toBe(false);
    expect(navEnabled(null)).toBe(false);
  });
});

describe('historyState', () => {
  it('deshabilita atrás/adelante y pinta detener mientras carga', () => {
    expect(historyState({ canGoBack: false, canGoForward: true, isLoading: true })).toEqual({
      backDisabled: true, forwardDisabled: false, reloadLabel: '✕', reloadTitle: 'Detener',
    });
    expect(historyState({ canGoBack: true, canGoForward: false, isLoading: false })).toEqual({
      backDisabled: false, forwardDisabled: true, reloadLabel: '↻', reloadTitle: 'Recargar',
    });
  });
});
