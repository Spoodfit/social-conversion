export type Platform = 'instagram' | 'youtube' | 'tiktok';
export type ConnectionStatus = 'connected' | 'attention' | 'limited';
export type LeadStage = 'Nouveau' | 'Qualifié' | 'Rendez-vous' | 'Proposition' | 'Gagné';

export interface Capability {
  key: 'comments' | 'direct_messages' | 'private_reply' | 'follow_trigger';
  label: string;
  available: boolean;
  note?: string;
}

export interface SocialConnection {
  id: string;
  platform: Platform;
  name: string;
  handle: string;
  status: ConnectionStatus;
  lastSync: string;
  accent: string;
  capabilities: Capability[];
}

export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  sender: string;
  body: string;
  timestamp: string;
  aiAssisted?: boolean;
}

export interface Conversation {
  id: string;
  name: string;
  handle: string;
  initials: string;
  platform: Platform;
  account: string;
  unread: number;
  priority: 'haute' | 'normale';
  lastMessage: string;
  time: string;
  sentiment: 'positif' | 'neutre';
  stage: LeadStage;
  intent: string;
  estimatedValue: number;
  messages: Message[];
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  platform: Platform;
  active: boolean;
  executions: number;
  conversion: number;
  caveat?: string;
}

export interface Lead {
  id: string;
  name: string;
  initials: string;
  handle: string;
  source: Platform;
  stage: LeadStage;
  value: number;
  score: number;
  lastActivity: string;
  tags: string[];
}

export interface DashboardMetric {
  label: string;
  value: string;
  delta: string;
  direction: 'up' | 'down';
  detail: string;
}

export interface FunnelStep {
  label: string;
  value: number;
  percent: number;
}

export interface BootstrapData {
  workspace: {
    name: string;
    plan: string;
    mode: 'demo' | 'live';
  };
  metrics: DashboardMetric[];
  funnel: FunnelStep[];
  weeklyActivity: number[];
  connections: SocialConnection[];
  conversations: Conversation[];
  automations: AutomationRule[];
  leads: Lead[];
  sources: Array<{ platform: Platform; conversations: number; qualified: number; revenue: number }>;
}

export interface NormalizedSocialEvent {
  id: string;
  platform: Platform;
  connectionId: string;
  eventType: 'message' | 'comment';
  externalContactId: string;
  contactName: string;
  text: string;
  occurredAt: string;
  raw: unknown;
}
