/**
 * src/renderer/core/appLibrary.js
 * --------------------------------------------------------------
 * Catálogo estático de webapps sugeridas para "Agregar al espacio".
 * Antes se cargaba desde una API remota; ahora es una lista fija — para
 * agregar una app puntual sigue estando la opción "URL manual".
 *
 * `category` + `description` alimentan la UI tipo marketplace del
 * catálogo (ver components/addToSpace.js): filtro por categoría y
 * tarjetas con bajada, como en App Store / Google Play.
 *
 * El icono usa el servicio de favicons de Google (solo necesita el host);
 * si falla, el render cae a un placeholder (ver addToSpace.js).
 * --------------------------------------------------------------
 */
function faviconFor(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
  } catch {
    return null;
  }
}

export const CATEGORIES = ['IA', 'Productividad', 'Comunicación', 'Diseño', 'Desarrollo', 'Utilidades'];

// `badge` reemplaza el favicon por un icono propio: emoji, o texto con
// colores (fondo `bg` + texto `color`) — ver render en addToSpace.js.
const APPS = [
  { name: 'Excalidraw', url: 'https://excalidraw.com', category: 'Diseño',
    description: 'Pizarra colaborativa para diagramas y bocetos a mano alzada.' },
  { name: 'tldraw', url: 'https://www.tldraw.com', category: 'Diseño',
    description: 'Pizarra infinita, rápida, para bocetar ideas y diagramas.' },
  { name: 'draw.io', url: 'https://app.diagrams.net', category: 'Diseño',
    description: 'Editor de diagramas de flujo, arquitectura y mapas mentales.' },
  { name: 'Klarinet', url: 'https://klarinet.vercel.app', category: 'Utilidades',
    badge: { text: '♪', bg: '#dc2626', color: '#ffffff' },
    description: 'Digitador de clarinete online.' },
  { name: 'ChatGPT', url: 'https://chat.openai.com', category: 'IA',
    description: 'Asistente conversacional de OpenAI.' },
  { name: 'Gemini', url: 'https://gemini.google.com', category: 'IA',
    description: 'Asistente conversacional de Google.' },
  { name: 'Claude', url: 'https://claude.ai/new', category: 'IA',
    description: 'Asistente conversacional de Anthropic.' },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com', category: 'IA',
    description: 'Asistente conversacional de DeepSeek.' },
  { name: 'GitHub', url: 'https://github.com', category: 'Desarrollo',
    description: 'Hosting de repositorios Git, issues y pull requests.' },
  { name: 'Hoppscotch', url: 'https://hoppscotch.io', category: 'Desarrollo',
    description: 'Cliente API ligero para probar endpoints REST/GraphQL/WebSocket.' },
  { name: 'Pomofocus', url: 'https://pomofocus.io', category: 'Productividad',
    description: 'Temporizador Pomodoro con listas de tareas y estadísticas.' },
  { name: 'Pomodoro Timer', url: 'https://pomodorotimer.online', category: 'Productividad',
    description: 'Temporizador Pomodoro minimalista, directo al grano.' },
  { name: 'Google Calendar', url: 'https://calendar.google.com/calendar/r/day', category: 'Productividad',
    badge: { text: '📅' }, description: 'Calendario y agenda de Google.' },
  { name: 'Standard Notes', url: 'https://app.standardnotes.com', category: 'Productividad',
    description: 'Notas cifradas de extremo a extremo, simples y duraderas.' },
  { name: 'Google', url: 'https://www.google.com', category: 'Utilidades',
    description: 'Buscador web.' },
  { name: 'YouTube', url: 'https://www.youtube.com', category: 'Utilidades',
    description: 'Videos y música en streaming.' },
  // Comunicación: webapps de chat. Corren bien en el webview (login
  // persistente por partición); lo que no tienen es notificaciones nativas.
  { name: 'Discord', url: 'https://discord.com/app', category: 'Comunicación',
    description: 'Chat por canales, voz y comunidades.' },
  { name: 'WhatsApp Web', url: 'https://web.whatsapp.com', category: 'Comunicación',
    description: 'Tus chats de WhatsApp desde el escritorio (vincula el teléfono con QR).' },
  { name: 'Slack', url: 'https://app.slack.com/client', category: 'Comunicación',
    description: 'Mensajería de equipos por canales.' },
  { name: 'Telegram Web', url: 'https://web.telegram.org', category: 'Comunicación',
    description: 'Cliente web de Telegram.' },
];

export const LIBRARY_APPS = APPS.map((app) => ({
  id: (() => { try { return new URL(app.url).hostname; } catch { return app.url; } })(),
  name: app.name,
  url: app.url,
  category: app.category,
  description: app.description || '',
  icon: faviconFor(app.url),
  badge: app.badge || null,
}));
