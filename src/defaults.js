const now = Date.now();

const iso = (value) => new Date(value).toISOString();

export const CALL_OUTCOMES = {
  LEAD_CAPTURED: "Lead Captured",
  APPOINTMENT_BOOKED: "Appointment Booked",
  FAQ_ANSWERED: "FAQ Answered",
  ESCALATED: "Escalated",
  VOICEMAIL: "Voicemail",
};

export const USER_ROLES = ["Owner", "Admin", "Viewer"];
export const AGENT_TONES = ["Professional", "Friendly", "Empathetic"];
export const AGENT_LANGUAGES = ["English", "Spanish", "French", "German"];
export const AGENT_VOICES = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir"];
export const CHATBOT_POSITIONS = ["left", "right"];
export const SUBSCRIPTION_PLANS = ["Starter", "Pro", "None"];

export const PLAN_LIMITS = {
  Starter: {
    callLimit: 100,
    minuteLimit: 500,
    amount: 49,
  },
  Pro: {
    callLimit: 500,
    minuteLimit: 2500,
    amount: 99,
  },
  None: {
    callLimit: 0,
    minuteLimit: 0,
    amount: 0,
  },
};

export const INITIAL_FAQS = [
  {
    id: "faq_1",
    question: "What are your operating hours?",
    answer: "We are open Monday to Friday from 9:00 AM to 5:00 PM Eastern Time.",
  },
  {
    id: "faq_2",
    question: "Where are you located?",
    answer: "Our office is located in Midtown Manhattan and we also support remote consultations.",
  },
  {
    id: "faq_3",
    question: "Do you accept new patients?",
    answer: "Yes. We are currently accepting new patients and can help schedule a first visit.",
  },
];

const cloneFaqs = (faqs = INITIAL_FAQS) => faqs.map((faq) => ({ ...faq }));

export const createVoiceAgent = (overrides = {}) => ({
  id: overrides.id || "voice_agent_1",
  name: overrides.name || "Maya",
  voice: overrides.voice || "Zephyr",
  language: overrides.language || "English",
  greeting: overrides.greeting || "Hello, thank you for calling Bright Path Dental. This is Maya. How can I assist you today?",
  tone: overrides.tone || "Professional",
  businessHours: overrides.businessHours || "09:00 - 17:00",
  faqs: cloneFaqs(overrides.faqs),
  escalationPhone: overrides.escalationPhone || "+1 (202) 555-0100",
  voicemailFallback: overrides.voicemailFallback ?? true,
  dataCaptureFields: Array.isArray(overrides.dataCaptureFields) && overrides.dataCaptureFields.length > 0
    ? [...overrides.dataCaptureFields]
    : ["name", "phone", "reason"],
  rules: {
    autoBook: overrides.rules?.autoBook ?? true,
    autoEscalate: overrides.rules?.autoEscalate ?? true,
    captureAllLeads: overrides.rules?.captureAllLeads ?? true,
  },
});

export const createChatbot = (overrides = {}) => ({
  id: overrides.id || "chatbot_1",
  name: overrides.name || "Website Concierge",
  voiceAgentId: overrides.voiceAgentId || "voice_agent_1",
  headerTitle: overrides.headerTitle || "Bright Path Dental Assistant",
  welcomeMessage: overrides.welcomeMessage || "Hi there! I'm here to answer questions, capture details, and help your visitors get the right next step.",
  placeholder: overrides.placeholder || "Ask about services, pricing, or availability...",
  launcherLabel: overrides.launcherLabel || "Chat with us",
  accentColor: overrides.accentColor || "#4F46E5",
  position: overrides.position || "right",
  avatarLabel: overrides.avatarLabel || "BP",
  customPrompt: overrides.customPrompt || "Keep responses concise, on-brand, and focused on helping visitors convert.",
  suggestedPrompts: Array.isArray(overrides.suggestedPrompts) && overrides.suggestedPrompts.length > 0
    ? [...overrides.suggestedPrompts]
    : ["What services do you offer?", "What are your hours?", "Can I book an appointment?"],
});

const buildInvoice = (id, daysAgo, amount, status) => ({
  id,
  date: iso(now - daysAgo * 24 * 60 * 60 * 1000),
  amount,
  status,
  pdfUrl: `/api/billing/invoices/${id}/download`,
});

export const createDefaultState = () => ({
  meta: {
    version: 1,
    seededAt: iso(now),
  },
  auth: {
    sessions: [
      {
        token: "demo-owner-token",
        userId: "u1",
        createdAt: iso(now),
        expiresAt: iso(now + 30 * 24 * 60 * 60 * 1000),
      },
    ],
    pendingMagicLinks: [],
  },
  currentUserId: "u1",
  organization: {
    id: "org_1",
    profile: {
      name: "Bright Path Dental",
      industry: "Healthcare",
      website: "www.brightpathdental.com",
      location: "New York, NY",
      onboarded: true,
      timezone: "America/New_York",
    },
    activeVoiceAgentId: "voice_agent_1",
    voiceAgents: [
      createVoiceAgent({
        id: "voice_agent_1",
      }),
    ],
    agent: createVoiceAgent({
      id: "voice_agent_1",
    }),
    activeChatbotId: "chatbot_1",
    chatbots: [
      createChatbot({
        id: "chatbot_1",
        voiceAgentId: "voice_agent_1",
      }),
    ],
    subscription: {
      plan: "Starter",
      status: "active",
      currentPeriodEnd: iso(now + 30 * 24 * 60 * 60 * 1000),
      usage: {
        calls: 84,
        minutes: 320,
        callLimit: PLAN_LIMITS.Starter.callLimit,
        minuteLimit: PLAN_LIMITS.Starter.minuteLimit,
      },
    },
    phoneNumber: "+1 (202) 555-0199",
    members: [
      {
        id: "u1",
        name: "Business Owner",
        email: "owner@example.com",
        role: "Owner",
      },
    ],
    invoices: [
      buildInvoice("inv_1003", 5, 49, "Paid"),
      buildInvoice("inv_1002", 35, 49, "Paid"),
      buildInvoice("inv_1001", 65, 49, "Paid"),
    ],
    settings: {
      timezone: "America/New_York",
      phoneNumber: "+1 (202) 555-0199",
    },
  },
  leads: [
    {
      id: "lead_1",
      name: "John Doe",
      email: "john@example.com",
      phone: "555-0101",
      reason: "Toothache consultation",
      createdAt: iso(now - 90 * 60 * 1000),
      status: "new",
    },
    {
      id: "lead_2",
      name: "Sarah Smith",
      email: "sarah@test.com",
      phone: "555-0202",
      reason: "Routine cleaning",
      createdAt: iso(now - 7 * 60 * 60 * 1000),
      status: "contacted",
    },
    {
      id: "lead_3",
      name: "Marcus Lee",
      email: "marcus@brightmail.com",
      phone: "555-0303",
      reason: "Whitening pricing inquiry",
      createdAt: iso(now - 26 * 60 * 60 * 1000),
      status: "closed",
    },
  ],
  calls: [
    {
      id: "call_1",
      callerName: "John Doe",
      callerPhone: "555-0101",
      duration: 145,
      timestamp: iso(now - 90 * 60 * 1000),
      outcome: CALL_OUTCOMES.LEAD_CAPTURED,
      summary: "Caller described acute tooth pain and asked for a same-week appointment follow-up.",
      transcript: [
        { speaker: "Agent", text: "Hello, thank you for calling Bright Path Dental. This is Maya. How can I assist you today?" },
        { speaker: "Caller", text: "Hi, my name is John Doe. I have a toothache and need someone to call me back today. My number is 555-0101." },
      ],
    },
    {
      id: "call_2",
      callerName: "Emily Carter",
      callerPhone: "555-0404",
      duration: 220,
      timestamp: iso(now - 5 * 60 * 60 * 1000),
      outcome: CALL_OUTCOMES.APPOINTMENT_BOOKED,
      summary: "Caller booked a first-time cleaning consultation for next Tuesday morning.",
      transcript: [
        { speaker: "Agent", text: "Bright Path Dental. Maya speaking." },
        { speaker: "Caller", text: "I would like to schedule a cleaning appointment for next week." },
      ],
    },
    {
      id: "call_3",
      callerName: "Unknown",
      callerPhone: "555-9999",
      duration: 45,
      timestamp: iso(now - 30 * 60 * 1000),
      outcome: CALL_OUTCOMES.FAQ_ANSWERED,
      summary: "Caller asked for location and office hours and ended the call after receiving the information.",
      transcript: [
        { speaker: "Agent", text: "Hello, thank you for calling. How can I help?" },
        { speaker: "Caller", text: "What time are you open tomorrow and where are you located?" },
      ],
    },
    {
      id: "call_4",
      callerName: "Dana Ruiz",
      callerPhone: "555-0505",
      duration: 77,
      timestamp: iso(now - 20 * 60 * 60 * 1000),
      outcome: CALL_OUTCOMES.ESCALATED,
      summary: "Caller requested a human representative to discuss insurance coverage details.",
      transcript: [
        { speaker: "Agent", text: "Hello, thank you for calling. How can I help?" },
        { speaker: "Caller", text: "Please transfer me to a person. I need help with insurance questions." },
      ],
    },
  ],
  conversations: {
    default: [],
    byChatbotId: {
      chatbot_1: [],
    },
  },
  contactMessages: [],
  salesInquiries: [],
  auditLog: [],
});

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const hydrateVoiceAgent = (agent, index) => createVoiceAgent({
  ...agent,
  id: agent?.id || `voice_agent_${index + 1}`,
  faqs: Array.isArray(agent?.faqs) && agent.faqs.length > 0 ? agent.faqs : INITIAL_FAQS,
  dataCaptureFields: Array.isArray(agent?.dataCaptureFields) ? agent.dataCaptureFields : undefined,
  rules: isPlainObject(agent?.rules) ? agent.rules : undefined,
});

const hydrateChatbot = (chatbot, index, fallbackVoiceAgentId, organizationName) => createChatbot({
  ...chatbot,
  id: chatbot?.id || `chatbot_${index + 1}`,
  voiceAgentId: chatbot?.voiceAgentId || fallbackVoiceAgentId,
  headerTitle: chatbot?.headerTitle || `${organizationName} Assistant`,
});

export const normalizeWorkspaceState = (state) => {
  const next = structuredClone(state);
  const organization = next.organization || {};
  const organizationName = organization.profile?.name || "Agently";

  const voiceAgentsSource = Array.isArray(organization.voiceAgents) && organization.voiceAgents.length > 0
    ? organization.voiceAgents
    : [organization.agent || createVoiceAgent()];

  organization.voiceAgents = voiceAgentsSource.map((agent, index) => hydrateVoiceAgent(agent, index));
  organization.activeVoiceAgentId = organization.voiceAgents.some((agent) => agent.id === organization.activeVoiceAgentId)
    ? organization.activeVoiceAgentId
    : organization.voiceAgents[0].id;

  const activeVoiceAgent = organization.voiceAgents.find((agent) => agent.id === organization.activeVoiceAgentId) || organization.voiceAgents[0];
  organization.agent = activeVoiceAgent;

  const chatbotsSource = Array.isArray(organization.chatbots) && organization.chatbots.length > 0
    ? organization.chatbots
    : [
      createChatbot({
        voiceAgentId: activeVoiceAgent.id,
        headerTitle: `${organizationName} Assistant`,
      }),
    ];

  organization.chatbots = chatbotsSource.map((chatbot, index) => {
    const preferredVoiceAgentId = organization.voiceAgents.some((agent) => agent.id === chatbot?.voiceAgentId)
      ? chatbot.voiceAgentId
      : activeVoiceAgent.id;
    return hydrateChatbot(chatbot, index, preferredVoiceAgentId, organizationName);
  });

  organization.activeChatbotId = organization.chatbots.some((chatbot) => chatbot.id === organization.activeChatbotId)
    ? organization.activeChatbotId
    : organization.chatbots[0].id;

  next.organization = organization;
  next.conversations = isPlainObject(next.conversations) ? next.conversations : {};

  const legacyConversation = Array.isArray(next.conversations.default) ? next.conversations.default : [];
  const byChatbotIdSource = isPlainObject(next.conversations.byChatbotId) ? next.conversations.byChatbotId : {};
  const normalizedByChatbotId = {};

  for (const chatbot of organization.chatbots) {
    const existingThread = Array.isArray(byChatbotIdSource[chatbot.id]) ? byChatbotIdSource[chatbot.id] : null;
    normalizedByChatbotId[chatbot.id] = existingThread
      ? structuredClone(existingThread)
      : (chatbot.id === organization.activeChatbotId ? structuredClone(legacyConversation) : []);
  }

  next.conversations.byChatbotId = normalizedByChatbotId;
  next.conversations.default = next.conversations.byChatbotId[organization.activeChatbotId] || [];

  return next;
};
