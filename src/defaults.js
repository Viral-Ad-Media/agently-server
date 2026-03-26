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
    agent: {
      name: "Maya",
      voice: "Zephyr",
      language: "English",
      greeting: "Hello, thank you for calling Bright Path Dental. This is Maya. How can I assist you today?",
      tone: "Professional",
      businessHours: "09:00 - 17:00",
      faqs: INITIAL_FAQS,
      escalationPhone: "+1 (202) 555-0100",
      voicemailFallback: true,
      dataCaptureFields: ["name", "phone", "reason"],
      rules: {
        autoBook: true,
        autoEscalate: true,
        captureAllLeads: true,
      },
    },
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
  },
  contactMessages: [],
  salesInquiries: [],
  auditLog: [],
});
