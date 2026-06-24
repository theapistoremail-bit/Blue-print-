import React, { useState, useRef, useEffect } from 'react';
import {
  Search, Image as ImageIcon, Music, Video, Box, Share2, Terminal, Type,
  Settings as SettingsIcon, Play, X, Trash2, Loader2, CheckCircle2,
  AlertCircle, Key, Zap
} from 'lucide-react';

const NODE_TYPES = {
  text:   { label: 'Texto / Prompt', icon: Type,      color: '#94a3b8' },
  search: { label: 'Búsqueda Web',   icon: Search,    color: '#22d3ee' },
  dev:    { label: 'Dev / Código',   icon: Terminal,  color: '#818cf8' },
  image:  { label: 'Imagen',         icon: ImageIcon, color: '#c084fc' },
  audio:  { label: 'Audio / Voz',    icon: Music,     color: '#fbbf24' },
  video:  { label: 'Video',          icon: Video,     color: '#fb7185' },
  threeD: { label: 'Objeto 3D',      icon: Box,       color: '#34d399' },
  social: { label: 'Publicar',       icon: Share2,    color: '#f472b6' },
};

const DEFAULT_CONFIG = {
  text:   {},
  search: {},
  dev:    { provider: 'claude' },
  image:  { provider: 'openai', version: '' },
  audio:  {},
  video:  { provider: 'stability', version: '' },
  threeD: {},
  social: { platforms: ['instagram', 'facebook'] },
};

const PLATFORMS = ['instagram', 'facebook', 'youtube', 'pinterest'];
const NODE_W = 260;
const PORT_Y = 26;

function uid(prefix) {
  return (prefix || 'n') + '_' + Math.random().toString(36).slice(2, 9);
}

// ---------------- API CALLS ----------------

async function callClaude(prompt, useSearch) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  };
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Claude API: ' + res.status);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function callOpenAIImage(prompt, apiKey) {
  if (!apiKey) throw new Error('Falta API key de OpenAI (Ajustes)');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
  });
  if (!res.ok) throw new Error('OpenAI: ' + res.status + ' ' + (await res.text()).slice(0, 150));
  const data = await res.json();
  return 'data:image/png;base64,' + data.data[0].b64_json;
}

async function callStabilityImage(prompt, apiKey) {
  if (!apiKey) throw new Error('Falta API key de Stability (Ajustes)');
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('output_format', 'png');
  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, Accept: 'image/*' },
    body: form,
  });
  if (!res.ok) throw new Error('Stability: ' + res.status + ' ' + (await res.text()).slice(0, 150));
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function callReplicate(apiKey, version, input) {
  if (!apiKey) throw new Error('Falta API key de Replicate (Ajustes)');
  if (!version) throw new Error('Falta la versión del modelo de Replicate (en el nodo)');
  const create = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + apiKey },
    body: JSON.stringify({ version, input }),
  });
  if (!create.ok) throw new Error('Replicate: ' + create.status + ' ' + (await create.text()).slice(0, 150));
  let pred = await create.json();
  while (pred.status === 'starting' || pred.status === 'processing') {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await fetch('https://api.replicate.com/v1/predictions/' + pred.id, {
      headers: { Authorization: 'Token ' + apiKey },
    });
    pred = await poll.json();
  }
  if (pred.status !== 'succeeded') throw new Error('Replicate: ' + pred.status + ' ' + (pred.error || ''));
  return pred.output;
}

async function callStabilityVideo(apiKey, imageUrl) {
  if (!apiKey) throw new Error('Falta API key de Stability (Ajustes)');
  if (!imageUrl) throw new Error('Conecta un nodo de Imagen antes del nodo de Video (Stability necesita una imagen de entrada)');
  const imgBlob = await (await fetch(imageUrl)).blob();
  const form = new FormData();
  form.append('image', imgBlob);
  const start = await fetch('https://api.stability.ai/v2beta/image-to-video', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey },
    body: form,
  });
  if (!start.ok) throw new Error('Stability video: ' + start.status + ' ' + (await start.text()).slice(0, 150));
  const startData = await start.json();
  const genId = startData.id;
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch('https://api.stability.ai/v2beta/image-to-video/result/' + genId, {
      headers: { Authorization: 'Bearer ' + apiKey, Accept: 'video/*' },
    });
    if (poll.status === 202) continue;
    if (!poll.ok) throw new Error('Stability video: ' + poll.status);
    const vb = await poll.blob();
    return URL.createObjectURL(vb);
  }
}

async function callElevenLabs(text, apiKey, voiceId) {
  if (!apiKey) throw new Error('Falta API key de ElevenLabs (Ajustes)');
  const vid = voiceId || '21m00Tcm4TlvDq8ikWAM';
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + vid, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
  });
  if (!res.ok) throw new Error('ElevenLabs: ' + res.status + ' ' + (await res.text()).slice(0, 150));
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function callMeshy(prompt, apiKey) {
  if (!apiKey) throw new Error('Falta API key de Meshy (Ajustes)');
  const create = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ mode: 'preview', prompt, art_style: 'realistic' }),
  });
  if (!create.ok) throw new Error('Meshy: ' + create.status + ' ' + (await create.text()).slice(0, 150));
  const createData = await create.json();
  const taskId = createData.result;
  let task;
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d/' + taskId, {
      headers: { Authorization: 'Bearer ' + apiKey },
    });
    task = await poll.json();
    if (task.status === 'SUCCEEDED' || task.status === 'FAILED') break;
  }
  if (task.status !== 'SUCCEEDED') throw new Error('Meshy: la generación falló');
  return { thumbnail: task.thumbnail_url, modelUrl: task.model_urls ? task.model_urls.glb : null };
}

async function callLeonardoImage(prompt, apiKey) {
  if (!apiKey) throw new Error('Falta API key de Leonardo AI (Ajustes)');
  const create = await fetch('https://cloud.leonardo.ai/api/rest/v1/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ prompt, num_images: 1, width: 1024, height: 1024 }),
  });
  if (!create.ok) throw new Error('Leonardo: ' + create.status + ' ' + (await create.text()).slice(0, 150));
  const createData = await create.json();
  const genId = createData.sdGenerationJob ? createData.sdGenerationJob.generationId : null;
  if (!genId) throw new Error('Leonardo: no se recibió un ID de generación');
  let job;
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch('https://cloud.leonardo.ai/api/rest/v1/generations/' + genId, {
      headers: { Authorization: 'Bearer ' + apiKey },
    });
    job = await poll.json();
    const status = job.generations_by_pk ? job.generations_by_pk.status : null;
    if (status === 'COMPLETE' || status === 'FAILED') break;
  }
  const images = job.generations_by_pk ? job.generations_by_pk.generated_images : [];
  if (!images || !images.length) throw new Error('Leonardo: la generación falló');
  return images[0].url;
}

async function callDeepSeek(prompt, apiKey) {
  if (!apiKey) throw new Error('Falta API key de DeepSeek (Ajustes)');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('DeepSeek: ' + res.status + ' ' + (await res.text()).slice(0, 150));
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callAyrshare(content, apiKey, platforms, mediaUrl) {
  if (!apiKey) throw new Error('Falta API key de Ayrshare (Ajustes)');
  const body = { post: content, platforms };
  if (mediaUrl) body.mediaUrls = [mediaUrl];
  const res = await fetch('https://app.ayrshare.com/api/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Ayrshare: ' + res.status + ' ' + (await res.text()).slice(0, 150));
  return res.json();
}

// ---------------- COMPONENT ----------------

export default function BlueprintStudio() {
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [apiKeys, setApiKeys] = useState({
    openai: '', stability: '', replicate: '', elevenlabs: '', elevenVoice: '', meshy: '', ayrshare: '',
    leonardo: '', deepseek: '',
  });
  const [showSettings, setShowSettings] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [drag, setDrag] = useState(null);
  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0 });
  const wrapRef = useRef(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    (async () => {
      try {
        const k = await window.storage.get('apiKeys', false);
        if (k) setApiKeys(prev => Object.assign({}, prev, JSON.parse(k.value)));
      } catch (e) {}
      try {
        const g = await window.storage.get('graph', false);
        if (g) {
          const parsed = JSON.parse(g.value);
          setNodes(parsed.nodes || []);
          setConnections(parsed.connections || []);
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      window.storage.set('graph', JSON.stringify({ nodes, connections }), false).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [nodes, connections, loaded]);

  function saveKeys(next) {
    setApiKeys(next);
    window.storage.set('apiKeys', JSON.stringify(next), false).catch(() => {});
  }

  function addNode(type) {
    const idx = nodes.length;
    const node = {
      id: uid(),
      type,
      x: -pan.x + 260 + (idx % 4) * 30,
      y: -pan.y + 60 + (idx % 6) * 40,
      prompt: '',
      config: Object.assign({}, DEFAULT_CONFIG[type]),
      status: 'idle',
      output: null,
      error: null,
    };
    setNodes(ns => ns.concat([node]));
  }

  function updateNode(id, patch) {
    setNodes(ns => ns.map(n => (n.id === id ? Object.assign({}, n, patch) : n)));
  }
  function updateConfig(id, patch) {
    setNodes(ns => ns.map(n => (n.id === id ? Object.assign({}, n, { config: Object.assign({}, n.config, patch) }) : n)));
  }
  function removeNode(id) {
    setNodes(ns => ns.filter(n => n.id !== id));
    setConnections(cs => cs.filter(c => c.from !== id && c.to !== id));
  }
  function removeConnection(id) {
    setConnections(cs => cs.filter(c => c.id !== id));
  }
  function clearAll() {
    if (window.confirm('¿Borrar todo el flujo?')) {
      setNodes([]);
      setConnections([]);
    }
  }

  async function runNode(id) {
    const node = nodesRef.current.find(n => n.id === id);
    if (!node) return;
    updateNode(id, { status: 'running', error: null });
    const upstream = connections
      .filter(c => c.to === id)
      .map(c => nodesRef.current.find(n => n.id === c.from))
      .filter(Boolean);
    const upstreamText = upstream
      .filter(n => n.output && n.output.type === 'text')
      .map(n => n.output.value)
      .join('\n\n');
    const upstreamImageNode = upstream.find(n => n.output && n.output.type === 'image');
    const upstreamImage = upstreamImageNode ? upstreamImageNode.output : null;
    const fullPrompt = [node.prompt, upstreamText].filter(Boolean).join('\n\n');

    try {
      let output;
      if (node.type === 'text') {
        output = { type: 'text', value: node.prompt || '' };
      } else if (node.type === 'search') {
        output = { type: 'text', value: await callClaude(fullPrompt, true) };
      } else if (node.type === 'dev') {
        const devPrompt = 'Eres un desarrollador de software experto. Tarea: ' + fullPrompt +
          '\n\nResponde solo con el código final, completo y bien comentado.';
        const devText = node.config.provider === 'deepseek'
          ? await callDeepSeek(devPrompt, apiKeys.deepseek)
          : await callClaude(devPrompt, false);
        output = { type: 'text', value: devText };
      } else if (node.type === 'image') {
        let url;
        if (node.config.provider === 'openai') url = await callOpenAIImage(fullPrompt, apiKeys.openai);
        else if (node.config.provider === 'stability') url = await callStabilityImage(fullPrompt, apiKeys.stability);
        else if (node.config.provider === 'leonardo') url = await callLeonardoImage(fullPrompt, apiKeys.leonardo);
        else {
          const out = await callReplicate(apiKeys.replicate, node.config.version, { prompt: fullPrompt });
          url = Array.isArray(out) ? out[0] : out;
        }
        output = { type: 'image', value: url };
      } else if (node.type === 'audio') {
        const url = await callElevenLabs(fullPrompt, apiKeys.elevenlabs, apiKeys.elevenVoice);
        output = { type: 'audio', value: url };
      } else if (node.type === 'video') {
        let url;
        if (node.config.provider === 'stability') {
          url = await callStabilityVideo(apiKeys.stability, upstreamImage ? upstreamImage.value : null);
        } else {
          const out = await callReplicate(apiKeys.replicate, node.config.version, {
            prompt: fullPrompt,
            image: upstreamImage ? upstreamImage.value : undefined,
          });
          url = Array.isArray(out) ? out[0] : out;
        }
        output = { type: 'video', value: url };
      } else if (node.type === 'threeD') {
        const r = await callMeshy(fullPrompt, apiKeys.meshy);
        output = { type: '3d', value: r.modelUrl, thumbnail: r.thumbnail };
      } else if (node.type === 'social') {
        const mediaOk = upstreamImage && /^https?:\/\//.test(upstreamImage.value);
        await callAyrshare(fullPrompt || node.prompt, apiKeys.ayrshare, node.config.platforms, mediaOk ? upstreamImage.value : null);
        output = {
          type: 'text',
          value: mediaOk
            ? 'Publicado ✓'
            : 'Publicado solo texto — la imagen conectada no es una URL pública, Ayrshare no pudo usarla ✓',
        };
      } else {
        output = { type: 'text', value: '' };
      }
      updateNode(id, { status: 'done', output });
    } catch (e) {
      updateNode(id, { status: 'error', error: (e && e.message) || String(e) });
    }
  }

  async function runAll() {
    const ids = nodesRef.current.map(n => n.id);
    const visited = new Set();
    const order = [];
    function visit(nid) {
      if (visited.has(nid)) return;
      visited.add(nid);
      connections.filter(c => c.to === nid).forEach(c => visit(c.from));
      order.push(nid);
    }
    ids.forEach(visit);
    for (const nid of order) {
      await runNode(nid);
    }
  }

  function worldFromEvent(e) {
    const rect = wrapRef.current.getBoundingClientRect();
    const p = e.touches && e.touches.length ? e.touches[0] : e;
    return { x: p.clientX - rect.left - pan.x, y: p.clientY - rect.top - pan.y };
  }

  function handleBgDown(e) {
    const p = e.touches && e.touches.length ? e.touches[0] : e;
    setDrag({ mode: 'pan', startX: p.clientX - pan.x, startY: p.clientY - pan.y });
  }
  function handleNodeDown(e, id) {
    e.stopPropagation();
    const node = nodes.find(n => n.id === id);
    const w = worldFromEvent(e);
    setDrag({ mode: 'node', id, offX: w.x - node.x, offY: w.y - node.y });
  }
  function handleOutDown(e, id) {
    e.stopPropagation();
    setDrag({ mode: 'wire', from: id });
  }
  function handleInUp(e, id) {
    e.stopPropagation();
    if (drag && drag.mode === 'wire' && drag.from !== id) {
      setConnections(cs => {
        if (cs.some(c => c.from === drag.from && c.to === id)) return cs;
        return cs.concat([{ id: uid('c'), from: drag.from, to: id }]);
      });
    }
    setDrag(null);
  }
  function handleMove(e) {
    if (!drag) return;
    const p = e.touches && e.touches.length ? e.touches[0] : e;
    if (drag.mode === 'pan') {
      setPan({ x: p.clientX - drag.startX, y: p.clientY - drag.startY });
    } else if (drag.mode === 'node') {
      const w = worldFromEvent(e);
      updateNode(drag.id, { x: w.x - drag.offX, y: w.y - drag.offY });
    } else if (drag.mode === 'wire') {
      setMouseWorld(worldFromEvent(e));
    }
  }
  function handleUp() {
    setDrag(null);
  }

  function portPos(node, side) {
    return { x: node.x + (side === 'out' ? NODE_W : 0), y: node.y + PORT_Y };
  }
  function pathFor(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return 'M ' + a.x + ' ' + a.y + ' C ' + (a.x + dx) + ' ' + a.y + ', ' + (b.x - dx) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
  }

  const KEY_FIELDS = [
    { key: 'openai', label: 'OpenAI (imágenes)' },
    { key: 'stability', label: 'Stability AI (imágenes / video)' },
    { key: 'replicate', label: 'Replicate (imágenes / video)' },
    { key: 'leonardo', label: 'Leonardo AI (imágenes)' },
    { key: 'deepseek', label: 'DeepSeek (Dev / Código)' },
    { key: 'elevenlabs', label: 'ElevenLabs (audio)' },
    { key: 'elevenVoice', label: 'ElevenLabs · Voice ID (opcional)' },
    { key: 'meshy', label: 'Meshy (3D)' },
    { key: 'ayrshare', label: 'Ayrshare (redes sociales)' },
  ];

  return (
    <div className="h-screen w-full flex flex-col" style={{ background: '#0b0c10', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="flex items-center justify-between px-4" style={{ height: 56, background: '#11131a', borderBottom: '1px solid #262934' }}>
        <div className="flex items-center gap-2">
          <Zap size={18} color="#22d3ee" />
          <span className="font-mono text-sm" style={{ color: '#e2e8f0', letterSpacing: '0.05em' }}>BLUEPRINT STUDIO</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded font-mono" style={{ background: '#22d3ee', color: '#0d0e12', fontSize: 12, fontWeight: 600 }}>
            <Play size={14} /> Ejecutar todo
          </button>
          <button onClick={clearAll} className="p-2 rounded" style={{ background: '#1c1f27' }}>
            <Trash2 size={16} color="#94a3b8" />
          </button>
          <button onClick={() => setShowSettings(true)} className="p-2 rounded" style={{ background: '#1c1f27' }}>
            <SettingsIcon size={16} color="#94a3b8" />
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="flex-1 relative overflow-hidden"
        style={{
          backgroundColor: '#0b0c10',
          backgroundImage: 'radial-gradient(#1b2a33 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          backgroundPosition: (pan.x % 22) + 'px ' + (pan.y % 22) + 'px',
          touchAction: 'none',
          cursor: drag && drag.mode === 'pan' ? 'grabbing' : 'default',
        }}
        onMouseMove={handleMove}
        onTouchMove={handleMove}
        onMouseUp={handleUp}
        onTouchEnd={handleUp}
        onMouseLeave={handleUp}
      >
        <div className="absolute z-20 flex flex-col gap-1 p-1.5 rounded-lg" style={{ left: 12, top: 12, background: 'rgba(17,19,26,0.92)', border: '1px solid #262934', backdropFilter: 'blur(6px)' }}>
          {Object.keys(NODE_TYPES).map(type => {
            const def = NODE_TYPES[type];
            const Icon = def.icon;
            return (
              <button
                key={type}
                onClick={() => addNode(type)}
                className="flex items-center gap-2 px-2.5 py-2 rounded font-mono"
                style={{ color: '#cbd5e1', fontSize: 12, background: 'transparent' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#1c1f27'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon size={14} color={def.color} />
                {def.label}
              </button>
            );
          })}
        </div>

        <div
          onMouseDown={handleBgDown}
          onTouchStart={handleBgDown}
          style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(' + pan.x + 'px,' + pan.y + 'px)' }}
        >
          <svg width={6000} height={6000} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {connections.map(c => {
              const a = nodes.find(n => n.id === c.from);
              const b = nodes.find(n => n.id === c.to);
              if (!a || !b) return null;
              const p1 = portPos(a, 'out');
              const p2 = portPos(b, 'in');
              return (
                <path
                  key={c.id}
                  d={pathFor(p1, p2)}
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="none"
                  style={{ filter: 'drop-shadow(0 0 3px rgba(34,211,238,0.6))', pointerEvents: 'stroke', cursor: 'pointer' }}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => removeConnection(c.id)}
                />
              );
            })}
            {drag && drag.mode === 'wire' ? (() => {
              const a = nodes.find(n => n.id === drag.from);
              if (!a) return null;
              const p1 = portPos(a, 'out');
              return <path d={pathFor(p1, mouseWorld)} stroke="#22d3ee" strokeWidth={2} strokeDasharray="4 3" fill="none" opacity={0.7} />;
            })() : null}
          </svg>

          {nodes.map(node => {
            const def = NODE_TYPES[node.type];
            const Icon = def.icon;
            return (
              <div
                key={node.id}
                style={{
                  position: 'absolute', left: node.x, top: node.y, width: NODE_W,
                  background: '#15171c',
                  border: '1px solid ' + (node.status === 'error' ? '#ef4444' : '#262934'),
                  borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', overflow: 'hidden',
                }}
              >
                <div
                  onMouseUp={e => handleInUp(e, node.id)}
                  onTouchEnd={e => handleInUp(e, node.id)}
                  style={{ position: 'absolute', left: -7, top: PORT_Y - 7, width: 14, height: 14, borderRadius: 14, background: '#0b0c10', border: '2px solid ' + def.color, cursor: 'crosshair', zIndex: 5 }}
                />

                <div
                  onMouseDown={e => handleNodeDown(e, node.id)}
                  onTouchStart={e => handleNodeDown(e, node.id)}
                  className="flex items-center justify-between px-3 py-2 cursor-grab"
                  style={{ background: '#1a1d24', borderBottom: '1px solid #262934' }}
                >
                  <div className="flex items-center gap-2 font-mono" style={{ color: '#e2e8f0', fontSize: 12 }}>
                    <Icon size={13} color={def.color} /> {def.label}
                  </div>
                  <div className="flex items-center gap-2">
                    {node.status === 'running' ? <Loader2 size={13} className="animate-spin" color="#22d3ee" /> : null}
                    {node.status === 'done' ? <CheckCircle2 size={13} color="#34d399" /> : null}
                    {node.status === 'error' ? <AlertCircle size={13} color="#ef4444" /> : null}
                    <button onClick={() => removeNode(node.id)} style={{ color: '#64748b' }}><X size={13} /></button>
                  </div>
                </div>

                <div className="p-3 flex flex-col gap-2">
                  {node.type === 'dev' ? (
                    <div className="flex gap-1">
                      {['claude', 'deepseek'].map(p => (
                        <button
                          key={p}
                          onClick={() => updateConfig(node.id, { provider: p })}
                          className="px-2 py-1 rounded font-mono"
                          style={{ fontSize: 10, background: node.config.provider === p ? '#22d3ee' : '#1c1f27', color: node.config.provider === p ? '#0d0e12' : '#94a3b8' }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {node.type === 'image' ? (
                    <div className="flex gap-1 flex-wrap">
                      {['openai', 'stability', 'replicate', 'leonardo'].map(p => (
                        <button
                          key={p}
                          onClick={() => updateConfig(node.id, { provider: p })}
                          className="px-2 py-1 rounded font-mono"
                          style={{ fontSize: 10, background: node.config.provider === p ? '#22d3ee' : '#1c1f27', color: node.config.provider === p ? '#0d0e12' : '#94a3b8' }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {node.type === 'image' && node.config.provider === 'replicate' ? (
                    <input
                      value={node.config.version || ''}
                      onChange={e => updateConfig(node.id, { version: e.target.value })}
                      placeholder="versión del modelo en Replicate"
                      className="w-full px-2 py-1.5 rounded font-mono"
                      style={{ fontSize: 11, background: '#0e0f13', border: '1px solid #262934', color: '#e2e8f0' }}
                    />
                  ) : null}

                  {node.type === 'video' ? (
                    <div className="flex gap-1">
                      {['stability', 'replicate'].map(p => (
                        <button
                          key={p}
                          onClick={() => updateConfig(node.id, { provider: p })}
                          className="px-2 py-1 rounded font-mono"
                          style={{ fontSize: 10, background: node.config.provider === p ? '#22d3ee' : '#1c1f27', color: node.config.provider === p ? '#0d0e12' : '#94a3b8' }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {node.type === 'video' && node.config.provider === 'replicate' ? (
                    <input
                      value={node.config.version || ''}
                      onChange={e => updateConfig(node.id, { version: e.target.value })}
                      placeholder="versión del modelo en Replicate"
                      className="w-full px-2 py-1.5 rounded font-mono"
                      style={{ fontSize: 11, background: '#0e0f13', border: '1px solid #262934', color: '#e2e8f0' }}
                    />
                  ) : null}

                  {node.type === 'social' ? (
                    <div className="flex flex-wrap gap-1">
                      {PLATFORMS.map(p => {
                        const active = node.config.platforms && node.config.platforms.indexOf(p) !== -1;
                        return (
                          <button
                            key={p}
                            onClick={() => {
                              const cur = node.config.platforms || [];
                              const next = active ? cur.filter(x => x !== p) : cur.concat([p]);
                              updateConfig(node.id, { platforms: next });
                            }}
                            className="px-2 py-1 rounded font-mono capitalize"
                            style={{ fontSize: 10, background: active ? '#f472b6' : '#1c1f27', color: active ? '#1a0a12' : '#94a3b8' }}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  <textarea
                    value={node.prompt}
                    onChange={e => updateNode(node.id, { prompt: e.target.value })}
                    placeholder={node.type === 'text' ? 'Escribe el texto fuente…' : node.type === 'social' ? 'Texto del post…' : 'Describe lo que necesitas…'}
                    rows={2}
                    className="w-full px-2 py-1.5 rounded resize-none font-mono"
                    style={{ fontSize: 12, background: '#0e0f13', border: '1px solid #262934', color: '#e2e8f0' }}
                  />

                  <button
                    onClick={() => runNode(node.id)}
                    disabled={node.status === 'running'}
                    className="flex items-center justify-center gap-1.5 py-1.5 rounded font-mono"
                    style={{ fontSize: 12, background: '#1c1f27', color: def.color, border: '1px solid ' + def.color + '40' }}
                  >
                    <Play size={12} /> Ejecutar
                  </button>

                  {node.error ? (
                    <div className="px-2 py-1.5 rounded" style={{ fontSize: 10, background: '#2a1215', color: '#fca5a5' }}>{node.error}</div>
                  ) : null}

                  {node.output ? (
                    <div className="rounded" style={{ border: '1px solid #262934', overflow: 'hidden' }}>
                      {node.output.type === 'text' ? (
                        <div className="p-2 whitespace-pre-wrap font-mono" style={{ fontSize: 10, maxHeight: 128, overflow: 'auto', color: '#cbd5e1' }}>{node.output.value}</div>
                      ) : null}
                      {node.output.type === 'image' ? <img src={node.output.value} className="w-full block" alt="" /> : null}
                      {node.output.type === 'audio' ? <audio controls src={node.output.value} className="w-full" style={{ display: 'block' }} /> : null}
                      {node.output.type === 'video' ? <video controls src={node.output.value} className="w-full block" /> : null}
                      {node.output.type === '3d' ? (
                        <div className="p-2 flex flex-col gap-1.5">
                          {node.output.thumbnail ? <img src={node.output.thumbnail} className="w-full rounded" alt="" /> : null}
                          {node.output.value ? <a href={node.output.value} target="_blank" rel="noreferrer" className="underline" style={{ fontSize: 10, color: '#34d399' }}>Descargar modelo .glb</a> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div
                  onMouseDown={e => handleOutDown(e, node.id)}
                  onTouchStart={e => handleOutDown(e, node.id)}
                  style={{ position: 'absolute', right: -7, top: PORT_Y - 7, width: 14, height: 14, borderRadius: 14, background: '#0b0c10', border: '2px solid ' + def.color, cursor: 'crosshair', zIndex: 5 }}
                />
              </div>
            );
          })}
        </div>

        {nodes.length === 0 ? (
          <div
            className="font-mono text-center pointer-events-none"
            style={{ position: 'absolute', left: '50%', top: '40%', transform: 'translate(-50%,-50%)', color: '#3f4654', fontSize: 12, lineHeight: 1.6 }}
          >
            Agrega un nodo desde el panel de la izquierda<br />y conéctalos arrastrando desde sus puertos
          </div>
        ) : null}
      </div>

      {showSettings ? (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', zIndex: 50 }}
          onClick={() => setShowSettings(false)}
        >
          <div onClick={e => e.stopPropagation()} className="w-full rounded-lg p-5" style={{ maxWidth: 420, background: '#15171c', border: '1px solid #262934' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 font-mono" style={{ color: '#e2e8f0', fontSize: 13 }}>
                <Key size={15} color="#22d3ee" /> API KEYS
              </div>
              <button onClick={() => setShowSettings(false)}><X size={16} color="#94a3b8" /></button>
            </div>
            <p className="mb-3" style={{ fontSize: 11, color: '#64748b' }}>
              Se guardan solo en tu sesión, no se comparten. Cada llamada usa tu cuenta y puede generar costo en ese proveedor. Los nodos de Búsqueda y el proveedor "claude" del nodo Dev ya funcionan sin key — no hace falta tu key de Anthropic aquí.
            </p>
            <div className="flex flex-col gap-2" style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {KEY_FIELDS.map(f => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="font-mono" style={{ fontSize: 10, color: '#94a3b8' }}>{f.label}</label>
                  <input
                    type="password"
                    value={apiKeys[f.key] || ''}
                    onChange={e => setApiKeys(k => Object.assign({}, k, { [f.key]: e.target.value }))}
                    className="w-full px-2.5 py-2 rounded font-mono"
                    style={{ fontSize: 12, background: '#0e0f13', border: '1px solid #262934', color: '#e2e8f0' }}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() => { saveKeys(apiKeys); setShowSettings(false); }}
              className="w-full mt-4 py-2 rounded font-mono"
              style={{ fontSize: 12, fontWeight: 600, background: '#22d3ee', color: '#0d0e12' }}
            >
              Guardar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
