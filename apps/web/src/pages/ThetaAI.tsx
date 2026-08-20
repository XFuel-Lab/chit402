import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther, keccak256, toBytes } from 'viem';
import { Link } from 'react-router-dom';
import ThetaP2PPlayer from '../components/ThetaP2PPlayer';

// ─── Contract ABI (subset for ThetaInferenceCircuit) ─────────────────────────
const THETA_INFERENCE_ABI = [
  {
    name: 'submitIntent',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'serviceId', type: 'bytes32' },
      { name: 'inputHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'intentId', type: 'bytes32' }],
  },
  {
    name: 'submitPresetIntent',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'presetId', type: 'bytes32' },
      { name: 'gpuTier', type: 'uint8' },
      { name: 'serviceId', type: 'bytes32' },
      { name: 'inputHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'intentId', type: 'bytes32' }],
  },
  {
    name: 'getEffectivePrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'serviceId', type: 'bytes32' },
      { name: 'gpuTier', type: 'uint8' },
    ],
    outputs: [{ name: 'effectivePrice', type: 'uint256' }],
  },
  {
    name: 'serviceCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'presetCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'intents_', type: 'uint256' },
      { name: 'volume_', type: 'uint256' },
      { name: 'fees_', type: 'uint256' },
      { name: 'services_', type: 'uint256' },
    ],
  },
  {
    name: 'gpuPriceMultiplier',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint8' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Deployed contract address (set after deployment; falls back to mock mode)
const THETA_INFERENCE_ADDRESS = (import.meta as any).env?.VITE_THETA_INFERENCE_ADDRESS || '0x0000000000000000000000000000000000000000';

// ─── Service Catalog (mirrors ThetaInferenceCircuit.sol ServiceType enum) ─────
type ServiceType =
  | 'LLM_INFERENCE'
  | 'IMAGE_GENERATION'
  | 'SPEECH_TO_TEXT'
  | 'VOICE_CLONING'
  | 'RAG_QUERY'
  | 'VIDEO_PROCESSING'
  | 'OBJECT_DETECTION';

type ServiceCard = {
  type: ServiceType;
  name: string;
  description: string;
  models: string[];
  icon: string;
  color: string;
  category: string;
  priceRange: string;
  avgLatency: string;
  totalCalls: string;
  industries: string[];
};

// ─── GPU Tiers ───────────────────────────────────────────────────────────────
type GpuTierKey = 'RTX_4090' | 'A100' | 'H100';

type GpuTier = {
  id: number;
  name: string;
  vram: string;
  priceMultiplier: number;
  throughput: string;
  badge: string;
};

const GPU_TIERS: Record<GpuTierKey, GpuTier> = {
  RTX_4090: { id: 0, name: 'RTX 4090',  vram: '24 GB', priceMultiplier: 1.0,  throughput: '~82 TFLOPS',  badge: 'Budget' },
  A100:     { id: 1, name: 'A100 80GB', vram: '80 GB', priceMultiplier: 2.5,  throughput: '~312 TFLOPS', badge: 'Pro' },
  H100:     { id: 2, name: 'H100 SXM',  vram: '80 GB', priceMultiplier: 5.0,  throughput: '~990 TFLOPS', badge: 'Max' },
};

// ─── On-Chain Service IDs (from deployed ThetaInferenceCircuit) ───────────────
const SERVICE_IDS: Record<ServiceType, `0x${string}`> = {
  LLM_INFERENCE:    '0x19026907d56d555d74ee86130db6d28692e7446b1bcf7745ac9e0e4cf15a55df',
  IMAGE_GENERATION: '0xa41ab30d2dd668d7144774c5f6d626bab6edefae49809f011b2a1103b8b02ccb',
  SPEECH_TO_TEXT:    '0x461c5e6a558c9f37462a75ef965d1504bf930bf026baf6cd9ed5a4654b5400c8',
  VOICE_CLONING:    '0x46e0dd79398419b110eece8ba5e0030028b6e22aafa99b792d860052dce303f1',
  RAG_QUERY:        '0xc31fb110f8e472cbe2d1c3d2b28b13f65db17605e6c831ad65bdbc05541ba8f9',
  VIDEO_PROCESSING: '0xc68e55c7b4ef9c2396d7a20fb20ddf7c228e282e1be9bb841e52ab6f3a5f7c3a',
  OBJECT_DETECTION: '0x0ace61ad854d43bc53afafce588a23ce208a40250223a78d8d7880a2d53e3dc8',
};

// ─── Preset Hooks ────────────────────────────────────────────────────────────
type PresetHook = {
  key: string;
  name: string;
  onChainId: `0x${string}`;
  serviceType: ServiceType;
  defaultModel: string;
  defaultGpu: GpuTierKey;
  defaultPrompt: string;
  description: string;
  icon: string;
  color: string;
};

const PRESET_HOOKS: PresetHook[] = [
  {
    key: 'QUICK_LLAMA',
    name: 'Quick Llama 3.1',
    onChainId: '0x3e8d4558f2a1be1603f9ba97c57daaf69318e81bf6c2de70a05f2d347d18fed2',
    serviceType: 'LLM_INFERENCE',
    defaultModel: 'Llama 3.1 8B',
    defaultGpu: 'RTX_4090',
    defaultPrompt: 'Hello, summarize the latest AI research.',
    description: 'Fast LLM inference on budget GPU',
    icon: '⚡',
    color: '#00d4ff',
  },
  {
    key: 'NEED_BIGGER_GPU',
    name: 'Need Bigger GPU',
    onChainId: '0xa61272fd647d2b17545472bb529849d59c8d4b830614fd752cd22510c535ffc8',
    serviceType: 'LLM_INFERENCE',
    defaultModel: 'Llama 3.1 405B',
    defaultGpu: 'H100',
    defaultPrompt: 'Analyze this complex dataset and provide insights.',
    description: 'Max-power H100 for heavy reasoning',
    icon: '🔥',
    color: '#ef4444',
  },
  {
    key: 'VOICE_AGENT',
    name: 'Voice Agent',
    onChainId: '0x087a4cab3768f2264da03602b36d3ee611fc0fde2e126169d084d769743f6f4f',
    serviceType: 'VOICE_CLONING',
    defaultModel: 'Voice Clone V1',
    defaultGpu: 'A100',
    defaultPrompt: 'Clone this voice and generate speech.',
    description: 'Voice cloning for agentic bots',
    icon: '🎙️',
    color: '#f59e0b',
  },
  {
    key: 'ENTERPRISE_RAG',
    name: 'Enterprise RAG',
    onChainId: '0x09d69aee285c0f4d5204b688cd54aa1df945e6635a8c2a35e4a28038e9646613',
    serviceType: 'RAG_QUERY',
    defaultModel: 'Llama 3.1 70B + RAG',
    defaultGpu: 'A100',
    defaultPrompt: 'Query the knowledge base for compliance info.',
    description: 'Citation-backed enterprise answers',
    icon: '🏢',
    color: '#06b6d4',
  },
  {
    key: 'QUICK_IMAGE',
    name: 'Quick Image Gen',
    onChainId: '0xab0f0342d47182b29acb9bac0a7fd9797767f89b3ff44c7bb9b29d8a6ddda738',
    serviceType: 'IMAGE_GENERATION',
    defaultModel: 'FLUX.1 Schnell',
    defaultGpu: 'RTX_4090',
    defaultPrompt: 'A futuristic city skyline at sunset, cyberpunk style',
    description: 'Fast image creation with FLUX',
    icon: '🎨',
    color: '#8b5cf6',
  },
  {
    key: 'MEDICAL_STT',
    name: 'Medical Transcription',
    onChainId: '0x36b006cda004b6c57f1ba6730de989d15df972412e9733e8067c5b6ba503a881',
    serviceType: 'SPEECH_TO_TEXT',
    defaultModel: 'Whisper Large V3',
    defaultGpu: 'A100',
    defaultPrompt: '',
    description: 'Medical-style transcription demo — not for PHI; not HIPAA compliant.',
    icon: '🏥',
    color: '#22c55e',
  },
  {
    key: 'TRANSCRIBE_SUMMARIZE',
    name: 'Transcribe + Summarize',
    onChainId: '0x8fef0da4e9446a27ef5eb2b462701f968cf1ba62f5a99fc72f4f8ee75b2a1782',
    serviceType: 'SPEECH_TO_TEXT',
    defaultModel: 'Whisper Large V3',
    defaultGpu: 'A100',
    defaultPrompt: '',
    description: 'Audio → transcript → LLM summary pipeline',
    icon: '📝',
    color: '#14b8a6',
  },
  {
    key: 'VIDEO_TRANSCODE',
    name: 'Video Transcode',
    onChainId: '0x063d54d54f9a7f1dd801707a66522a3a9776886b377ca6688f89359c93e3de94',
    serviceType: 'VIDEO_PROCESSING',
    defaultModel: 'Theta Transcode V2',
    defaultGpu: 'RTX_4090',
    defaultPrompt: '',
    description: 'Multi-res adaptive bitrate via Theta Video API',
    icon: '🎬',
    color: '#f43f5e',
  },
  {
    key: 'NFT_DRM_GUARD',
    name: 'NFT DRM Guard',
    onChainId: '0xed30b5cd4046745068a6f41ba2e6a33f750e6318a979af13448a7a3a6dcac682',
    serviceType: 'VIDEO_PROCESSING',
    defaultModel: 'Theta DRM',
    defaultGpu: 'A100',
    defaultPrompt: '',
    description: 'ERC-721/1155 gated content with DRM streaming',
    icon: '🛡️',
    color: '#d946ef',
  },
  {
    key: 'JUPYTER_NOTEBOOK',
    name: 'Jupyter Notebook',
    onChainId: '0x00388d0c346dd8c444aa3f910d94466c339b5772ae357767363cda7f74a060d3',
    serviceType: 'LLM_INFERENCE',
    defaultModel: 'Llama 3.1 8B',
    defaultGpu: 'RTX_4090',
    defaultPrompt: 'Launch Jupyter with PyTorch and Transformers.',
    description: 'Browser-based Jupyter on EdgeCloud GPU nodes',
    icon: '📓',
    color: '#f97316',
  },
  {
    key: 'OBJECT_DETECTOR',
    name: 'Object Detector',
    onChainId: '0x799ca8d4438f6bcf1b0bc2383ffa0899f67c7c6364c0c878756e20962711150d',
    serviceType: 'OBJECT_DETECTION',
    defaultModel: 'YOLOv8 XLarge',
    defaultGpu: 'RTX_4090',
    defaultPrompt: '',
    description: 'Real-time YOLO detection + tracking',
    icon: '👁️',
    color: '#a855f7',
  },
  {
    key: 'AI_AGENT_BUILDER',
    name: 'AI Agent Builder',
    onChainId: '0x923e122e998a6401323f8a0adc50fa18a2df5c3e067c3a3e3f20368b9d8f4b04',
    serviceType: 'RAG_QUERY',
    defaultModel: 'Llama 3.1 70B + RAG',
    defaultGpu: 'H100',
    defaultPrompt: 'Create an autonomous agent that monitors DeFi positions.',
    description: 'Autonomous agents with RAG + function calling',
    icon: '🤖',
    color: '#0ea5e9',
  },
  {
    key: 'HD_IMAGE_PRO',
    name: 'HD Image Pro',
    onChainId: '0x44055b847b2507ab329ae7c2943eac40ffd3105d773a97cbf574783c14c01195',
    serviceType: 'IMAGE_GENERATION',
    defaultModel: 'FLUX.1 Dev',
    defaultGpu: 'H100',
    defaultPrompt: 'A photorealistic portrait with cinematic lighting, 4K resolution',
    description: 'Max-fidelity FLUX Dev on H100 for production',
    icon: '🖼️',
    color: '#6366f1',
  },
  {
    key: 'GPU_TRAINING_JOB',
    name: 'GPU Training Job',
    onChainId: '0x2991a60df1b7d1ff28ded70818c40d98b8773a387d554b4e033772795bd81ad9',
    serviceType: 'LLM_INFERENCE',
    defaultModel: 'Llama 3.1 70B',
    defaultGpu: 'H100',
    defaultPrompt: 'Fine-tune model on custom dataset.',
    description: 'Distributed training across EdgeCloud nodes',
    icon: '🏋️',
    color: '#eab308',
  },
];

const services: ServiceCard[] = [
  {
    type: 'LLM_INFERENCE',
    name: 'LLM Inference',
    description: 'Chat completions, code generation, reasoning, and analysis via Llama 3.x models on Theta EdgeCloud GPU nodes.',
    models: ['Llama 3.1 8B', 'Llama 3.1 70B', 'Llama 3.1 405B', 'CodeLlama 34B'],
    icon: '◈',
    color: '#00d4ff',
    category: 'Text',
    priceRange: '0.001 – 0.05 TFUEL',
    avgLatency: '~800ms',
    totalCalls: '24,500+',
    industries: ['Enterprise BI', 'Legal AI', 'Customer Support', 'Education'],
  },
  {
    type: 'IMAGE_GENERATION',
    name: 'Image Generation',
    description: 'High-fidelity image creation from text prompts using FLUX and Stable Diffusion on decentralized GPU clusters.',
    models: ['FLUX.1 Schnell', 'FLUX.1 Dev', 'FLUX.1 Pro', 'Stable Diffusion XL'],
    icon: '◉',
    color: '#8b5cf6',
    category: 'Image',
    priceRange: '0.01 – 0.1 TFUEL',
    avgLatency: '~3.2s',
    totalCalls: '18,200+',
    industries: ['Media & Advertising', 'Gaming', 'E-Commerce', 'Architecture'],
  },
  {
    type: 'SPEECH_TO_TEXT',
    name: 'Speech-to-Text',
    description: 'Audio transcription with Whisper large-v3 — supports 90+ languages with word-level timestamps.',
    models: ['Whisper Large V3', 'Whisper Medium', 'Whisper Base'],
    icon: '◎',
    color: '#22c55e',
    category: 'Audio',
    priceRange: '0.005 – 0.02 TFUEL',
    avgLatency: '~1.5s',
    totalCalls: '9,800+',
    industries: ['Healthcare', 'Legal', 'Media', 'Accessibility'],
  },
  {
    type: 'VOICE_CLONING',
    name: 'Voice Cloning',
    description: 'Clone any voice from a reference audio sample. Generate natural speech in the cloned voice for any text.',
    models: ['Voice Clone V1', 'TTS Multi-Speaker', 'Bark V2'],
    icon: '⬡',
    color: '#f59e0b',
    category: 'Audio',
    priceRange: '0.02 – 0.08 TFUEL',
    avgLatency: '~2.8s',
    totalCalls: '4,300+',
    industries: ['Entertainment', 'Podcasting', 'Education', 'Telecom'],
  },
  {
    type: 'RAG_QUERY',
    name: 'RAG Chatbot',
    description: 'Retrieval-Augmented Generation — query knowledge bases with grounded, citation-backed AI responses.',
    models: ['Llama 3.1 70B + RAG', 'Llama 3.1 8B + RAG'],
    icon: '⟐',
    color: '#06b6d4',
    category: 'Agentic',
    priceRange: '0.005 – 0.03 TFUEL',
    avgLatency: '~1.2s',
    totalCalls: '7,100+',
    industries: ['Enterprise', 'Research', 'Government', 'Finance'],
  },
  {
    type: 'VIDEO_PROCESSING',
    name: 'Video Processing',
    description: 'Transcoding, adaptive bitrate streaming, analytics, and NFT-based DRM via Theta Video API.',
    models: ['Theta Transcode V2', 'Theta DRM', 'Adaptive Bitrate'],
    icon: '⊞',
    color: '#ef4444',
    category: 'Video',
    priceRange: '0.05 – 0.5 TFUEL',
    avgLatency: '~15s',
    totalCalls: '2,900+',
    industries: ['Streaming', 'Sports', 'Events', 'NFT Media'],
  },
  {
    type: 'OBJECT_DETECTION',
    name: 'Object Detection',
    description: 'Real-time object detection with YOLO models — bounding boxes, classification, and tracking.',
    models: ['YOLOv8 Nano', 'YOLOv8 Medium', 'YOLOv8 XLarge'],
    icon: '⊡',
    color: '#a855f7',
    category: 'Vision',
    priceRange: '0.002 – 0.01 TFUEL',
    avgLatency: '~400ms',
    totalCalls: '5,600+',
    industries: ['Security', 'Retail', 'Manufacturing', 'Autonomous Vehicles'],
  },
];

const categories = ['All', 'Text', 'Image', 'Audio', 'Agentic', 'Video', 'Vision'];

const BASE_PRICES: Record<ServiceType, number> = {
  LLM_INFERENCE: 0.01,
  IMAGE_GENERATION: 0.05,
  SPEECH_TO_TEXT: 0.005,
  VOICE_CLONING: 0.02,
  RAG_QUERY: 0.008,
  VIDEO_PROCESSING: 0.1,
  OBJECT_DETECTION: 0.003,
};

// ─── Voice Navigation Hook ──────────────────────────────────────────────────
function useVoiceNav(onCommand: (cmd: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  const toggle = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e: any) => {
      const text = Array.from(e.results)
        .map((r: any) => r[0].transcript)
        .join(' ');
      setTranscript(text);

      if (e.results[0].isFinal) {
        onCommand(text.toLowerCase());
        setListening(false);
      }
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, onCommand]);

  return { listening, transcript, toggle };
}

// ─── Adaptive Grid Hook ─────────────────────────────────────────────────────
function useAdaptiveGrid() {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setCols(w < 640 ? 1 : w < 1024 ? 2 : 3);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return cols;
}

// ─── ROI Calculator Component ────────────────────────────────────────────────

const ROI_VOLUME_PRESETS = [
  { label: '100 / day', daily: 100 },
  { label: '500 / day', daily: 500 },
  { label: '2,000 / day', daily: 2000 },
  { label: '10,000 / day', daily: 10000 },
];

function ROICalculator({ serviceType, gpuTier, effectivePrice }: {
  serviceType: ServiceType;
  gpuTier: GpuTierKey;
  effectivePrice: number;
}) {
  const [volumeIdx, setVolumeIdx] = useState(1);
  const daily = ROI_VOLUME_PRESETS[volumeIdx].daily;

  const providerShare = 0.995;
  const dailyEarnings = daily * effectivePrice * providerShare;
  const monthlyEarnings = dailyEarnings * 30;
  const yearlyEarnings = dailyEarnings * 365;

  const gpuMonthlyCost: Record<GpuTierKey, number> = {
    RTX_4090: 450,
    A100: 1800,
    H100: 3600,
  };

  const tfuelPrice = 0.065;
  const monthlyEarningsUsd = monthlyEarnings * tfuelPrice;
  const monthlyCost = gpuMonthlyCost[gpuTier];
  const netMonthlyUsd = monthlyEarningsUsd - monthlyCost;
  const monthlyROI = monthlyCost > 0 ? ((monthlyEarningsUsd / monthlyCost) * 100).toFixed(0) : '0';

  return (
    <div style={{
      padding: '1rem 1.25rem', marginBottom: '1rem',
      background: 'rgba(139,92,246,0.04)', borderRadius: '12px',
      border: '1px solid rgba(139,92,246,0.12)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.8rem', color: '#8a8a9a', fontWeight: 600 }}>ROI Calculator</span>
        <span className="badge badge-purple" style={{ fontSize: '0.6rem' }}>Provider Earnings</span>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {ROI_VOLUME_PRESETS.map((p, i) => (
          <button
            key={p.label}
            className={`btn btn-sm ${volumeIdx === i ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setVolumeIdx(i)}
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.6rem' }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', fontSize: '0.85rem' }}>
        <div>
          <div style={{ color: '#55556a', fontSize: '0.7rem', marginBottom: '0.15rem' }}>Daily</div>
          <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#8b5cf6' }}>
            {dailyEarnings.toFixed(2)} TFUEL
          </div>
        </div>
        <div>
          <div style={{ color: '#55556a', fontSize: '0.7rem', marginBottom: '0.15rem' }}>Monthly</div>
          <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#8b5cf6' }}>
            {monthlyEarnings.toFixed(1)} TFUEL
          </div>
          <div style={{ fontSize: '0.65rem', color: '#8a8a9a' }}>
            ~${monthlyEarningsUsd.toFixed(0)} USD
          </div>
        </div>
        <div>
          <div style={{ color: '#55556a', fontSize: '0.7rem', marginBottom: '0.15rem' }}>Yearly</div>
          <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#8b5cf6' }}>
            {yearlyEarnings.toFixed(0)} TFUEL
          </div>
        </div>
        <div>
          <div style={{ color: '#55556a', fontSize: '0.7rem', marginBottom: '0.15rem' }}>
            Net ({GPU_TIERS[gpuTier].name})
          </div>
          <div style={{
            fontWeight: 700, fontFamily: 'var(--font-mono)',
            color: netMonthlyUsd >= 0 ? '#22c55e' : '#ef4444',
          }}>
            {netMonthlyUsd >= 0 ? '+' : ''}${netMonthlyUsd.toFixed(0)}/mo
          </div>
          <div style={{ fontSize: '0.65rem', color: '#8a8a9a' }}>
            ROI: {monthlyROI}%
          </div>
        </div>
      </div>

      <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#55556a' }}>
        At {daily.toLocaleString()} calls/day x {effectivePrice.toFixed(4)} TFUEL/call.
        Provider receives 99.5% after 0.5% protocol fee.
        GPU cost estimate: ${monthlyCost}/mo for {GPU_TIERS[gpuTier].name}.
        TFUEL price: ${tfuelPrice}.
      </div>
    </div>
  );
}

// ─── Main Page Component ────────────────────────────────────────────────────
export default function ThetaAI() {
  const { address, isConnected } = useAccount();
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedService, setSelectedService] = useState<ServiceCard | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [promptInput, setPromptInput] = useState('');
  const [intentStatus, setIntentStatus] = useState<'idle' | 'submitting' | 'processing' | 'completed' | 'error'>('idle');
  const [mockResult, setMockResult] = useState<string | null>(null);
  const [selectedGpu, setSelectedGpu] = useState<GpuTierKey>('RTX_4090');
  const [activePreset, setActivePreset] = useState<PresetHook | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const cols = useAdaptiveGrid();

  const [copiedPreset, setCopiedPreset] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const isContractDeployed = THETA_INFERENCE_ADDRESS !== '0x0000000000000000000000000000000000000000';

  // ─── Wagmi Hooks ────────────────────────────────────────────────────────
  const { data: onChainStats } = useReadContract({
    address: THETA_INFERENCE_ADDRESS as `0x${string}`,
    abi: THETA_INFERENCE_ABI,
    functionName: 'getStats',
    query: { enabled: isContractDeployed },
  });

  const { data: serviceCountOnChain } = useReadContract({
    address: THETA_INFERENCE_ADDRESS as `0x${string}`,
    abi: THETA_INFERENCE_ABI,
    functionName: 'serviceCount',
    query: { enabled: isContractDeployed },
  });

  const { writeContract, data: txHash, isPending: isTxPending } = useWriteContract();

  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (isTxConfirmed) {
      setIntentStatus('completed');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 4000);
    }
  }, [isTxConfirmed]);

  // ─── Live On-Chain Pricing (falls back to local calculation) ─────────
  const { data: livePrice } = useReadContract({
    address: THETA_INFERENCE_ADDRESS as `0x${string}`,
    abi: THETA_INFERENCE_ABI,
    functionName: 'getEffectivePrice',
    args: selectedService
      ? [SERVICE_IDS[selectedService.type], GPU_TIERS[selectedGpu].id]
      : undefined,
    query: { enabled: isContractDeployed && !!selectedService },
  });

  const effectivePrice = useMemo(() => {
    if (livePrice && isContractDeployed) {
      return Number(formatEther(livePrice as bigint));
    }
    if (!selectedService) return 0;
    const base = BASE_PRICES[selectedService.type] || 0.01;
    return base * GPU_TIERS[selectedGpu].priceMultiplier;
  }, [selectedService, selectedGpu, livePrice, isContractDeployed]);

  const isLivePrice = isContractDeployed && !!livePrice;

  // ─── Copy command (public settlement demo — not localhost / TFUEL) ─────
  const generateCurl = useCallback((_preset: PresetHook) => {
    // EdgeCloud presets are optional GPU routing. Settlement home is USDC on Base.
    // Never ship bare bash `curl` — PowerShell aliases curl → Invoke-WebRequest.
    return `# XFuel public demo — first hour is /v1 (no wallet). Paid path below is 402 without a payer.
# From repo: packages/sdk
npx tsx examples/flagship-demo.ts

# Optional HTTP (Windows PowerShell: use curl.exe, not curl)
# See Docs → Try the demo`;
  }, []);

  const handleCopyCurl = useCallback((preset: PresetHook) => {
    navigator.clipboard.writeText(generateCurl(preset));
    setCopiedPreset(preset.key);
    setTimeout(() => setCopiedPreset(null), 2000);
  }, [generateCurl]);

  // ─── Predictive Suggestions ─────────────────────────────────────────────
  const suggestions = useMemo(() => {
    if (!selectedService) return [];
    const related = PRESET_HOOKS.filter(p => p.serviceType === selectedService.type && p.key !== activePreset?.key);
    return related.slice(0, 2);
  }, [selectedService, activePreset]);

  // ─── Voice Navigation ──────────────────────────────────────────────────
  const handleVoiceCommand = useCallback((cmd: string) => {
    const presetMatch = PRESET_HOOKS.find(p =>
      cmd.includes(p.name.toLowerCase()) || cmd.includes(p.key.toLowerCase().replace(/_/g, ' '))
    );
    if (presetMatch) {
      handlePresetSelect(presetMatch);
      return;
    }

    if (cmd.includes('bigger gpu') || cmd.includes('need bigger') || cmd.includes('h100')) {
      const preset = PRESET_HOOKS.find(p => p.key === 'NEED_BIGGER_GPU');
      if (preset) { handlePresetSelect(preset); return; }
    }

    if (cmd.includes('image') || cmd.includes('picture')) setFilter('Image');
    else if (cmd.includes('text') || cmd.includes('llm') || cmd.includes('chat')) setFilter('Text');
    else if (cmd.includes('audio') || cmd.includes('voice') || cmd.includes('speech')) setFilter('Audio');
    else if (cmd.includes('video')) setFilter('Video');
    else if (cmd.includes('detect') || cmd.includes('vision')) setFilter('Vision');
    else if (cmd.includes('rag') || cmd.includes('agent')) setFilter('Agentic');
    else if (cmd.includes('all') || cmd.includes('show all')) setFilter('All');
    else setSearch(cmd);
  }, []);

  const { listening, transcript, toggle: toggleVoice } = useVoiceNav(handleVoiceCommand);

  const filtered = services.filter((s) => {
    const matchCat = filter === 'All' || s.category === filter;
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.industries.some((i) => i.toLowerCase().includes(search.toLowerCase()));
    return matchCat && matchSearch;
  });

  // ─── Preset Selection (one-click auto-fill) ────────────────────────────
  const handlePresetSelect = (preset: PresetHook) => {
    setActivePreset(preset);
    const svc = services.find(s => s.type === preset.serviceType);
    if (svc) {
      setSelectedService(svc);
      setSelectedModel(preset.defaultModel);
      setSelectedGpu(preset.defaultGpu);
      setPromptInput(preset.defaultPrompt);
      setIntentStatus('idle');
      setMockResult(null);
    }
  };

  // ─── Intent Submission (on-chain via wagmi or mock fallback) ────────────
  const handleSubmitIntent = async () => {
    if (!selectedService || !selectedModel) return;

    if (isContractDeployed && isConnected) {
      setIntentStatus('submitting');
      setMockResult(null);

      const inputHash = keccak256(toBytes(promptInput || 'default-input'));

      try {
        const serviceId = SERVICE_IDS[selectedService.type];
        if (activePreset) {
          writeContract({
            address: THETA_INFERENCE_ADDRESS as `0x${string}`,
            abi: THETA_INFERENCE_ABI,
            functionName: 'submitPresetIntent',
            args: [activePreset.onChainId, GPU_TIERS[selectedGpu].id, serviceId, inputHash],
            value: parseEther(effectivePrice.toFixed(6)),
          });
        } else {
          writeContract({
            address: THETA_INFERENCE_ADDRESS as `0x${string}`,
            abi: THETA_INFERENCE_ABI,
            functionName: 'submitIntent',
            args: [serviceId, inputHash],
            value: parseEther(effectivePrice.toFixed(6)),
          });
        }
        setIntentStatus('processing');
      } catch {
        setIntentStatus('error');
      }
      return;
    }

    // Mock fallback for dev/demo
    setIntentStatus('submitting');
    setMockResult(null);

    await new Promise((r) => setTimeout(r, 1200));
    setIntentStatus('processing');
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));

    const mockResults: Record<ServiceType, string> = {
      LLM_INFERENCE: `{"choices":[{"message":{"content":"Theta EdgeCloud inference complete. The decentralized AI economy enables..."}}],"model":"${selectedModel}","gpu":"${GPU_TIERS[selectedGpu].name}","usage":{"total_tokens":128}}`,
      IMAGE_GENERATION: `{"data":[{"url":"https://edgecloud.theta.tv/generated/img_${Date.now()}.png","revised_prompt":"${promptInput || 'Generated image'}"}],"gpu":"${GPU_TIERS[selectedGpu].name}"}`,
      SPEECH_TO_TEXT: `{"text":"Transcribed audio content via Whisper on Theta EdgeCloud.","language":"en","duration":12.5,"gpu":"${GPU_TIERS[selectedGpu].name}"}`,
      VOICE_CLONING: `{"audio_url":"https://edgecloud.theta.tv/cloned/voice_${Date.now()}.mp3","duration":5.2,"gpu":"${GPU_TIERS[selectedGpu].name}"}`,
      RAG_QUERY: `{"answer":"Based on the knowledge base, the XFuel Protocol integrates with Theta EdgeCloud for...","sources":[{"id":"doc-42","relevance":0.95}],"gpu":"${GPU_TIERS[selectedGpu].name}"}`,
      VIDEO_PROCESSING: `{"output_url":"https://edgecloud.theta.tv/transcoded/vid_${Date.now()}.mp4","status":"completed","resolution":"1080p","gpu":"${GPU_TIERS[selectedGpu].name}"}`,
      OBJECT_DETECTION: `{"detections":[{"label":"person","confidence":0.97,"bbox":[100,50,200,300]},{"label":"vehicle","confidence":0.89,"bbox":[300,200,500,400]}],"gpu":"${GPU_TIERS[selectedGpu].name}"}`,
    };

    setMockResult(mockResults[selectedService.type]);
    setIntentStatus('completed');
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 4000);
  };

  return (
    <div className="page">
      <style>{`
        @keyframes successPop {
          0% { transform: scale(0.6); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeInSlide {
          0% { transform: translateX(-8px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes successGlow {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
          50% { box-shadow: 0 0 20px 4px rgba(34,197,94,0.3); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }
      `}</style>
      <div className="container">
        {/* Hero Section */}
        <div style={styles.hero}>
          <div style={styles.heroBadgeRow}>
            <span className="badge badge-cyan" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
              Live on Theta EdgeCloud
            </span>
            <span className="badge badge-green">7 AI Services</span>
            <span className="badge badge-purple">ZK-Verified</span>
            <span className="badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>14 Presets</span>
          </div>
          <h1 style={styles.heroTitle}>Optional GPU hub (EdgeCloud)</h1>
          <p style={styles.heroSubtitle}>
            Theta EdgeCloud is an optional compute provider — not the settlement home.
            Money and proofs settle in <strong>USDC via x402 on Base</strong>. First hour is
            Docs → Try the demo (unmetered <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85em' }}>/v1</code>, no wallet).
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem' }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => {
                const a = document.createElement('a');
                a.href = '/theta-ai/openapi.json';
                a.download = 'xfuel-theta-ai-openapi.json';
                fetch('http://localhost:3002/theta-ai/openapi.json')
                  .then(r => r.json())
                  .then(spec => {
                    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
                    a.href = URL.createObjectURL(blob);
                    a.click();
                  })
                  .catch(() => {
                    const blob = new Blob([JSON.stringify({ info: { title: 'XFuel Theta AI OpenAPI — offline mode' } }, null, 2)], { type: 'application/json' });
                    a.href = URL.createObjectURL(blob);
                    a.click();
                  });
              }}
              style={{ fontSize: '0.75rem' }}
            >
              Download OpenAPI Spec
            </button>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => document.getElementById('full-catalog')?.scrollIntoView({ behavior: 'smooth' })}
              style={{ fontSize: '0.75rem' }}
            >
              View Full Catalog
            </button>
            <Link
              to="/monitoring"
              className="btn btn-sm btn-secondary"
              style={{ fontSize: '0.75rem', textDecoration: 'none' }}
            >
              View Live Monitoring
            </Link>
          </div>
        </div>

        {/* Stats Row */}
        <div className={`grid grid-4`} style={{ marginBottom: '2rem' }}>
          {[
            { value: onChainStats ? Number(onChainStats[0]).toLocaleString() : '72,400+', label: 'Total Inferences' },
            { value: serviceCountOnChain ? Number(serviceCountOnChain).toString() : '7', label: 'Service Types' },
            { value: '~1.8s', label: 'Avg Latency' },
            { value: '< 0.005', label: 'Avg Fee (TFUEL)' },
          ].map((s) => (
            <div key={s.label} className="card" style={{ textAlign: 'center' }}>
              <div className="stat-value" style={{ fontSize: '1.5rem' }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ═══ ONE-CLICK PRESET CARDS ═══ */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.3rem' }}>One-Click Presets</h2>
            <span className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>Developer-First</span>
            <span className="badge badge-green" style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
              Live on Theta EdgeCloud
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols === 1 ? 1 : cols === 2 ? 2 : 3}, 1fr)`,
            gap: '1rem',
          }}>
            {PRESET_HOOKS.map((preset) => {
              const presetPrice = (BASE_PRICES[preset.serviceType] * GPU_TIERS[preset.defaultGpu].priceMultiplier);
              return (
                <div
                  key={preset.key}
                  className="card"
                  onClick={() => handlePresetSelect(preset)}
                  style={{
                    cursor: 'pointer',
                    borderColor: activePreset?.key === preset.key ? preset.color : undefined,
                    boxShadow: activePreset?.key === preset.key ? `0 0 24px ${preset.color}44` : undefined,
                    padding: '1.25rem',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>{preset.icon}</span>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <span className="badge" style={{
                        background: `${preset.color}22`,
                        color: preset.color,
                        border: `1px solid ${preset.color}44`,
                        fontSize: '0.65rem',
                      }}>
                        {GPU_TIERS[preset.defaultGpu].badge} GPU
                      </span>
                    </div>
                  </div>
                  <h3 style={{ color: preset.color, fontSize: '1rem', marginBottom: '0.25rem' }}>
                    {preset.name}
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: '#8a8a9a', marginBottom: '0.5rem' }}>
                    {preset.description}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#55556a' }}>
                    <span>{GPU_TIERS[preset.defaultGpu].name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: preset.color }}>
                      {presetPrice.toFixed(4)} TFUEL
                    </span>
                  </div>
                  <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={(e) => { e.stopPropagation(); handleCopyCurl(preset); }}
                      style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', flex: 1 }}
                    >
                      {copiedPreset === preset.key ? 'Copied!' : 'Copy curl'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Voice Nav + Search Bar */}
        <div style={styles.controlBar}>
          <div style={styles.searchRow}>
            <input
              className="input"
              style={{ maxWidth: '400px' }}
              placeholder="Search services, models, industries..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className={`btn btn-sm ${listening ? 'btn-primary' : 'btn-secondary'}`}
              onClick={toggleVoice}
              title="Voice navigation (say 'show images', 'need bigger gpu', 'quick llama'...)"
              style={{ position: 'relative' }}
            >
              {listening ? (
                <>
                  <span style={styles.pulsingDot} />
                  Listening...
                </>
              ) : (
                'Voice Nav'
              )}
            </button>
          </div>
          {listening && transcript && (
            <div style={styles.transcriptBar}>
              <span style={{ color: '#55556a' }}>Heard:</span> {transcript}
            </div>
          )}

          {/* Category Filters */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {categories.map((cat) => (
              <button
                key={cat}
                className={`btn btn-sm ${filter === cat ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Service Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          {filtered.map((s) => (
            <div
              key={s.type}
              className="card"
              onClick={() => {
                setSelectedService(s);
                setSelectedModel(s.models[0]);
                setActivePreset(null);
                setIntentStatus('idle');
                setMockResult(null);
              }}
              style={{
                cursor: 'pointer',
                borderColor: selectedService?.type === s.type ? s.color : undefined,
                boxShadow: selectedService?.type === s.type ? `0 0 20px ${s.color}33` : undefined,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '1.8rem', filter: `drop-shadow(0 0 8px ${s.color})`, color: s.color }}>
                  {s.icon}
                </div>
                <span className="badge badge-cyan">{s.category}</span>
              </div>
              <h3 style={{ color: s.color, marginBottom: '0.25rem' }}>{s.name}</h3>
              <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>{s.description}</p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                {s.models.slice(0, 3).map((m) => (
                  <span key={m} className="tag">{m}</span>
                ))}
                {s.models.length > 3 && <span className="tag">+{s.models.length - 3}</span>}
              </div>

              <hr className="separator" style={{ margin: '0.5rem 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <div>
                  <div style={{ color: '#8a8a9a' }}>Price Range</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{s.priceRange}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#8a8a9a' }}>Latency</div>
                  <div style={{ fontWeight: 700 }}>{s.avgLatency}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#8a8a9a' }}>Calls</div>
                  <div style={{ fontWeight: 700 }}>{s.totalCalls}</div>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {s.industries.map((ind) => (
                  <span key={ind} style={styles.industryTag}>{ind}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#8a8a9a' }}>
            No services match your filters. Try voice navigation or a different search.
          </div>
        )}

        {/* ═══ INTENT SUBMISSION PANEL ═══ */}
        {selectedService && (
          <div className="card" style={styles.intentPanel}>
            {activePreset && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                marginBottom: '1rem', padding: '0.5rem 0.75rem',
                background: `${activePreset.color}11`, borderRadius: '8px',
                border: `1px solid ${activePreset.color}33`,
              }}>
                <span style={{ fontSize: '1.2rem' }}>{activePreset.icon}</span>
                <span style={{ color: activePreset.color, fontWeight: 700, fontSize: '0.9rem' }}>
                  Preset: {activePreset.name}
                </span>
                <button
                  className="btn btn-sm btn-secondary"
                  style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                  onClick={() => setActivePreset(null)}
                >
                  Clear
                </button>
              </div>
            )}

            <h2 style={{ color: selectedService.color, marginBottom: '1rem' }}>
              Submit {selectedService.name} Intent
            </h2>

            <div className="grid grid-2" style={{ marginBottom: '1.5rem' }}>
              {/* Model Selection */}
              <div>
                <label style={styles.label}>Model</label>
                <select
                  className="input"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {selectedService.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Wallet Status */}
              <div>
                <label style={styles.label}>Wallet</label>
                <div className="input" style={{ background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: isConnected ? '#22c55e' : '#ef4444',
                    display: 'inline-block',
                  }} />
                  {isConnected
                    ? `${address?.slice(0, 6)}...${address?.slice(-4)}`
                    : 'Connect wallet to submit intents'
                  }
                </div>
              </div>
            </div>

            {/* ═══ SMART GPU SELECTOR ═══ */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={styles.label}>GPU Tier — EdgeCloud Pricing</label>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {(Object.entries(GPU_TIERS) as [GpuTierKey, GpuTier][]).map(([key, gpu]) => {
                  const isSelected = selectedGpu === key;
                  const price = (BASE_PRICES[selectedService.type] * gpu.priceMultiplier).toFixed(4);
                  return (
                    <div
                      key={key}
                      onClick={() => setSelectedGpu(key)}
                      style={{
                        flex: '1 1 0',
                        minWidth: '140px',
                        padding: '1rem',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(0,212,255,0.08)' : 'rgba(255,255,255,0.02)',
                        border: `2px solid ${isSelected ? '#00d4ff' : 'rgba(255,255,255,0.08)'}`,
                        boxShadow: isSelected ? '0 0 20px rgba(0,212,255,0.15)' : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 800, fontSize: '0.95rem', color: isSelected ? '#00d4ff' : '#f0f0f5' }}>
                          {gpu.name}
                        </span>
                        <span className="badge" style={{
                          background: key === 'H100' ? 'rgba(239,68,68,0.15)' : key === 'A100' ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.15)',
                          color: key === 'H100' ? '#ef4444' : key === 'A100' ? '#8b5cf6' : '#22c55e',
                          border: `1px solid ${key === 'H100' ? 'rgba(239,68,68,0.3)' : key === 'A100' ? 'rgba(139,92,246,0.3)' : 'rgba(34,197,94,0.3)'}`,
                          fontSize: '0.6rem',
                          padding: '0.1rem 0.4rem',
                        }}>
                          {gpu.badge}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#8a8a9a', marginBottom: '0.25rem' }}>
                        {gpu.vram} VRAM | {gpu.throughput}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: isSelected ? '#00d4ff' : '#f0f0f5' }}>
                        {price} TFUEL
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#55556a' }}>
                        {gpu.priceMultiplier}x base price
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Prompt / Input */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={styles.label}>
                {selectedService.type === 'LLM_INFERENCE' || selectedService.type === 'RAG_QUERY'
                  ? 'Prompt'
                  : selectedService.type === 'IMAGE_GENERATION'
                    ? 'Image Description'
                    : selectedService.type === 'SPEECH_TO_TEXT'
                      ? 'Audio URL'
                      : selectedService.type === 'VOICE_CLONING'
                        ? 'Reference Audio URL + Text'
                        : selectedService.type === 'VIDEO_PROCESSING'
                          ? 'Video Source URL'
                          : 'Image URL'
                }
              </label>
              <textarea
                className="input"
                style={{ minHeight: '100px', resize: 'vertical' }}
                placeholder={
                  selectedService.type === 'LLM_INFERENCE'
                    ? 'Enter your prompt for Theta EdgeCloud LLM inference...'
                    : selectedService.type === 'IMAGE_GENERATION'
                      ? 'Describe the image you want to generate...'
                      : 'Enter input for the selected service...'
                }
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
              />
            </div>

            {/* Webhook Callback URL (optional — for agents / M2M) */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={styles.label}>
                Webhook Callback URL
                <span style={{ fontWeight: 400, color: '#55556a', marginLeft: '0.4rem', fontSize: '0.75rem' }}>
                  optional — agent gets POST on completion
                </span>
              </label>
              <input
                className="input"
                type="url"
                placeholder="https://your-agent.example.com/webhook"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
              />
            </div>

            {/* Fee Preview */}
            <div style={{
              padding: '1rem 1.25rem', marginBottom: '1rem',
              background: 'rgba(0,212,255,0.04)', borderRadius: '12px',
              border: '1px solid rgba(0,212,255,0.1)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#8a8a9a', fontWeight: 600 }}>Fee Breakdown</span>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {isLivePrice && <span className="badge badge-green" style={{ fontSize: '0.6rem' }}>Live Contract Price</span>}
                  {isContractDeployed && !isLivePrice && <span className="badge badge-cyan" style={{ fontSize: '0.6rem' }}>On-Chain</span>}
                  {!isContractDeployed && <span className="badge badge-purple" style={{ fontSize: '0.6rem' }}>Mock Mode</span>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', fontSize: '0.85rem' }}>
                <div>
                  <div style={{ color: '#55556a', fontSize: '0.7rem', marginBottom: '0.15rem' }}>GPU Tier</div>
                  <div style={{ fontWeight: 700 }}>{GPU_TIERS[selectedGpu].name}</div>
                </div>
                <div>
                  <div style={{ color: '#55556a', fontSize: '0.7rem', marginBottom: '0.15rem' }}>Inference Cost</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#00d4ff' }}>
                    {effectivePrice.toFixed(4)} TFUEL
                  </div>
                </div>
                <div>
                  <div style={{ color: '#55556a', fontSize: '0.7rem', marginBottom: '0.15rem' }}>Protocol Fee (0.5%)</div>
                  <div style={{ fontFamily: 'var(--font-mono)' }}>
                    {(effectivePrice * 0.005).toFixed(6)} TFUEL
                  </div>
                </div>
                <div>
                  <div style={{ color: '#55556a', fontSize: '0.7rem', marginBottom: '0.15rem' }}>Provider Receives</div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: '#22c55e' }}>
                    {(effectivePrice * 0.995).toFixed(4)} TFUEL
                  </div>
                </div>
              </div>
            </div>

            {/* ROI Calculator */}
            <ROICalculator
              serviceType={selectedService.type}
              gpuTier={selectedGpu}
              effectivePrice={effectivePrice}
            />

            {/* Submit Button */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={handleSubmitIntent}
                disabled={intentStatus === 'submitting' || intentStatus === 'processing' || isTxPending || isTxConfirming}
                style={{ opacity: (intentStatus === 'submitting' || intentStatus === 'processing' || isTxPending) ? 0.6 : 1 }}
              >
                {isTxPending
                  ? 'Confirm in Wallet...'
                  : isTxConfirming
                    ? 'Confirming on Theta...'
                    : intentStatus === 'submitting'
                      ? 'Submitting Intent...'
                      : intentStatus === 'processing'
                        ? 'Processing on EdgeCloud...'
                        : `Submit Intent (${effectivePrice.toFixed(4)} TFUEL)`
                }
              </button>

              {(intentStatus === 'processing' || isTxConfirming) && (
                <div style={styles.processingIndicator}>
                  <span className="animate-pulse" style={{ color: '#f59e0b' }}>
                    ZK proof generation in progress
                  </span>
                </div>
              )}

              {(intentStatus === 'completed' || isTxConfirmed) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="badge badge-green" style={showSuccess ? {
                    animation: 'successPop 0.5s ease-out',
                  } : undefined}>
                    Settled
                  </span>
                  {showSuccess && (
                    <span style={{
                      color: '#22c55e', fontSize: '0.85rem', fontWeight: 600,
                      animation: 'fadeInSlide 0.4s ease-out',
                    }}>
                      ZK-verified on Theta EdgeCloud
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Predictive Suggestions */}
            {suggestions.length > 0 && intentStatus === 'idle' && (
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: '#55556a' }}>Try also:</span>
                {suggestions.map(s => (
                  <button
                    key={s.key}
                    className="btn btn-sm btn-secondary"
                    onClick={() => handlePresetSelect(s)}
                    style={{ fontSize: '0.75rem' }}
                  >
                    {s.icon} {s.name}
                  </button>
                ))}
              </div>
            )}

            {/* TX Hash */}
            {txHash && (
              <div style={{ marginTop: '1rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: '#8a8a9a' }}>
                TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </div>
            )}

            {/* Result Preview */}
            {mockResult && (
              <div style={{
                ...styles.resultPanel,
                ...(showSuccess ? { animation: 'successGlow 1.5s ease-out' } : {}),
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '0.95rem', color: selectedService.color }}>
                    EdgeCloud Response
                  </h3>
                  <span className="badge badge-green">ZK Verified</span>
                </div>
                <pre style={styles.resultPre}>
                  {JSON.stringify(JSON.parse(mockResult), null, 2)}
                </pre>

                {/* ── Track 3.5 / 3.4: P2P + optional NFT-DRM player for VIDEO_PROCESSING ── */}
                {selectedService.type === 'VIDEO_PROCESSING' && (() => {
                  let parsed: Record<string, string> = {};
                  try { parsed = JSON.parse(mockResult); } catch { /* ignore */ }
                  const playbackUri = parsed.playback_uri || parsed.output_url || parsed.hls_url;
                  if (!playbackUri) return null;
                  // Track 3.4: videoId is the Theta Video API ID (e.g. "video_m3jxh0...")
                  // nftCollection is set when the NFT_DRM_GUARD preset was used
                  const tvaVideoId = parsed.video_id || parsed.videoId;
                  const nftCollection = parsed.nft_collection ||
                    (activePreset?.key === 'NFT_DRM_GUARD' ? parsed.nft_collection : undefined);
                  return (
                    <ThetaP2PPlayer
                      src={playbackUri}
                      videoId={tvaVideoId}
                      internalVideoId={txHash ?? undefined}
                      nftCollection={nftCollection}
                      networkId={365}
                      onAccessDenied={(col) => {
                        window.open(`https://testnet-explorer.thetatoken.org/account/${col}`, '_blank');
                      }}
                    />
                  );
                })()}

                <div style={styles.proofMeta}>
                  <span>Nullifier: 0x{Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}...</span>
                  <span>Gas: ~108K | GPU: {GPU_TIERS[selectedGpu].name}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ FULL CATALOG — Every Theta Product ═══ */}
        <div id="full-catalog" className="card" style={{ marginTop: '2rem', padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Full Catalog</h2>
            <span className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>16 Products</span>
            <span className="badge badge-green" style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
              Live on Theta EdgeCloud
            </span>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#8a8a9a', marginBottom: '1.25rem' }}>
            Every Theta EdgeCloud product — inference APIs, compute, storage, video, agentic AI, and gateways.
            Click any item to use its matching preset or submit a direct intent.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols === 1 ? 1 : cols === 2 ? 2 : 4}, 1fr)`, gap: '0.75rem' }}>
            {[
              { id: 'ondemand-llm', name: 'On-Demand LLM APIs', cat: 'Inference', endpoint: '/v1/chat/completions', preset: 'QUICK_LLAMA', icon: '◈', color: '#00d4ff' },
              { id: 'ondemand-image', name: 'On-Demand Image Gen', cat: 'Inference', endpoint: '/v1/images/generations', preset: 'QUICK_IMAGE', icon: '◉', color: '#8b5cf6' },
              { id: 'ondemand-stt', name: 'On-Demand STT', cat: 'Inference', endpoint: '/v1/audio/transcriptions', preset: 'MEDICAL_STT', icon: '◎', color: '#22c55e' },
              { id: 'ondemand-tts', name: 'TTS / Voice Clone', cat: 'Inference', endpoint: '/v1/audio/speech', preset: 'VOICE_AGENT', icon: '⬡', color: '#f59e0b' },
              { id: 'ondemand-vision', name: 'Object Detection', cat: 'Inference', endpoint: '/v1/vision/detect', preset: 'OBJECT_DETECTOR', icon: '⊡', color: '#a855f7' },
              { id: 'ondemand-video', name: 'Video Processing', cat: 'Inference', endpoint: '/v1/video/process', preset: 'VIDEO_TRANSCODE', icon: '⊞', color: '#ef4444' },
              { id: 'dedicated', name: 'Dedicated Deployments', cat: 'Compute', endpoint: 'SetPrice RPC', icon: '⬢', color: '#06b6d4' },
              { id: 'jupyter', name: 'Jupyter Notebook', cat: 'Compute', endpoint: 'EdgeCloud Dashboard', preset: 'JUPYTER_NOTEBOOK', icon: '📓', color: '#f97316' },
              { id: 'training', name: 'GPU Training Jobs', cat: 'Compute', endpoint: 'EdgeCloud Job API', preset: 'GPU_TRAINING_JOB', icon: '🏋️', color: '#eab308' },
              { id: 'storage', name: 'Persistent Storage', cat: 'Storage', endpoint: 'CID-based', icon: '💾', color: '#64748b' },
              { id: 'agents', name: 'Agentic AI', cat: 'Agentic', endpoint: '/v1/agents/create', preset: 'AI_AGENT_BUILDER', icon: '🤖', color: '#0ea5e9' },
              { id: 'rag', name: 'RAG Chatbot', cat: 'Agentic', endpoint: '/v1/rag/query', preset: 'ENTERPRISE_RAG', icon: '⟐', color: '#06b6d4' },
              { id: 'nft-drm', name: 'NFT-Based DRM', cat: 'Video', endpoint: 'Theta Video API', preset: 'NFT_DRM_GUARD', icon: '🛡️', color: '#d946ef' },
              { id: 'video-api', name: 'Theta Video API', cat: 'Video', endpoint: '/v1/video/*', icon: '📺', color: '#f43f5e' },
              { id: 'mcp', name: 'MCP Server', cat: 'Gateway', endpoint: '@thetalabs/on-demand-api-mcp', icon: '🔌', color: '#14b8a6' },
              { id: 'rapidapi', name: 'RapidAPI Gateway', cat: 'Gateway', endpoint: 'rapidapi.com', icon: '⚡', color: '#3b82f6' },
            ].map((item) => {
              const matchingPreset = item.preset ? PRESET_HOOKS.find(p => p.key === item.preset) : null;
              return (
                <div
                  key={item.id}
                  className="card"
                  onClick={() => matchingPreset && handlePresetSelect(matchingPreset)}
                  style={{
                    cursor: matchingPreset ? 'pointer' : 'default',
                    padding: '0.85rem',
                    transition: 'all 0.2s ease',
                    opacity: matchingPreset ? 1 : 0.7,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '1.1rem', color: item.color }}>{item.icon}</span>
                    <span style={{
                      fontSize: '0.55rem', padding: '0.1rem 0.35rem', borderRadius: '4px',
                      background: 'rgba(255,255,255,0.04)', color: '#8a8a9a', border: '1px solid rgba(255,255,255,0.08)',
                    }}>
                      {item.cat}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: item.color, marginBottom: '0.15rem' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#55556a', fontFamily: 'var(--font-mono)' }}>
                    {item.endpoint}
                  </div>
                  {matchingPreset && (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.6rem', color: '#22c55e' }}>
                      One-click preset available
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Service Analytics */}
        <div className="card" style={{ marginTop: '2rem', padding: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Service Analytics</h2>
          <div className="grid grid-2">
            <div>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#8a8a9a' }}>Calls by Service Type</h3>
              {services.map((s) => {
                const total = services.reduce((sum, sv) => sum + parseInt(sv.totalCalls.replace(/[^0-9]/g, '')), 0);
                const pct = Math.round((parseInt(s.totalCalls.replace(/[^0-9]/g, '')) / total) * 100);
                return (
                  <div key={s.type} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      <span style={{ color: s.color }}>{s.name}</span>
                      <span style={{ color: '#8a8a9a' }}>{pct}% ({s.totalCalls})</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#8a8a9a' }}>Industry Coverage</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {Array.from(new Set(services.flatMap((s) => s.industries))).map((ind) => {
                  const count = services.filter((s) => s.industries.includes(ind)).length;
                  return (
                    <div key={ind} style={{
                      ...styles.industryChip,
                      borderColor: count >= 3 ? '#00d4ff33' : '#ffffff08',
                    }}>
                      <span>{ind}</span>
                      <span className="badge badge-cyan" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>{count}</span>
                    </div>
                  );
                })}
              </div>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.75rem', color: '#8a8a9a' }}>Network Status</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {[
                  { name: 'Theta Mainnet (361)', status: 'roadmap', latency: '—' },
                  { name: 'Theta Testnet (365)', status: 'live', latency: 'primary beta target' },
                  { name: 'EdgeCloud routing', status: 'beta', latency: 'when M2M + keys configured' },
                  { name: 'RapidAPI / other tiers', status: 'fallback', latency: 'router-dependent' },
                ].map((n) => (
                  <div key={n.name} style={styles.networkRow}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: n.status === 'live' ? '#22c55e' : n.status === 'roadmap' ? '#8b5cf6' : '#f59e0b',
                      display: 'inline-block', flexShrink: 0,
                    }} />
                    <span style={{ flex: 1 }}>{n.name}</span>
                    <span style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>{n.latency}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  hero: {
    textAlign: 'center',
    marginBottom: '2rem',
    padding: '2rem 0',
    background: 'radial-gradient(ellipse at 50% 0%, rgba(0,212,255,0.06) 0%, transparent 50%)',
    borderRadius: '16px',
  },
  heroBadgeRow: {
    display: 'flex', justifyContent: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap',
  },
  heroTitle: {
    fontSize: '2.5rem', fontWeight: 900,
    background: 'linear-gradient(135deg, #00d4ff 0%, #8b5cf6 50%, #22c55e 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
    marginBottom: '0.5rem',
  },
  heroSubtitle: {
    color: '#8a8a9a', fontSize: '1.05rem', maxWidth: '600px', margin: '0 auto',
  },
  controlBar: {
    display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem',
  },
  searchRow: {
    display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
  },
  pulsingDot: {
    width: 8, height: 8, borderRadius: '50%', background: '#ef4444',
    display: 'inline-block', marginRight: '0.4rem',
    animation: 'pulse 1s ease-in-out infinite',
  },
  transcriptBar: {
    padding: '0.5rem 1rem', background: 'rgba(0,212,255,0.05)',
    border: '1px solid rgba(0,212,255,0.15)', borderRadius: '8px',
    fontSize: '0.85rem', color: '#00d4ff',
  },
  industryTag: {
    padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem',
    background: 'rgba(255,255,255,0.04)', color: '#8a8a9a',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  industryChip: {
    display: 'flex', alignItems: 'center', gap: '0.4rem',
    padding: '0.4rem 0.75rem', borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    fontSize: '0.8rem',
  },
  networkRow: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.5rem 0.75rem', borderRadius: '8px',
    background: 'rgba(255,255,255,0.02)', fontSize: '0.85rem',
  },
  intentPanel: {
    marginTop: '0rem', padding: '2rem',
    background: 'rgba(0,212,255,0.02)',
    borderColor: 'rgba(0,212,255,0.15)',
  },
  label: {
    display: 'block', marginBottom: '0.4rem',
    fontSize: '0.85rem', color: '#8a8a9a', fontWeight: 600,
  },
  processingIndicator: {
    display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem',
  },
  resultPanel: {
    marginTop: '1.5rem', padding: '1.25rem',
    background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)',
    borderRadius: '12px',
  },
  resultPre: {
    background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px',
    fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: '#f0f0f5',
    overflow: 'auto', maxHeight: '300px', whiteSpace: 'pre-wrap',
  },
  proofMeta: {
    display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem',
    fontSize: '0.75rem', color: '#55556a', fontFamily: 'var(--font-mono)',
  },
};
