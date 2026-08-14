const SKILLS = [
  {
    id: 'email',
    triggers: ['send a memo', 'memo to', 'email tap4500', 'send an email', 'email memo'],
    instruction:
      'You can send low-urgency memo emails to tap4500@gmail.com via the send_email_memo tool. ' +
      'Compose a clear subject and a concise body. Ask for clarification only if subject/body are unclear.',
  },
  {
    id: 'crm',
    triggers: ['list leads', 'the leads', 'launch the campaign', 'aetherdesk campaign', 'our leads', 'crm'],
    instruction:
      'You can query AetherDesk CRM: use aetherdesk_list_leads to see leads and ' +
      'aetherdesk_launch_campaign to launch an outbound campaign. Prefer summarizing results for the user.',
  },
  {
    id: 'aetherdesk',
    triggers: ['aetherdesk agent', 'call center agents', 'list agents', 'agents in aetherdesk'],
    instruction:
      'You can list AetherDesk call center agents with aetherdesk_list_agents. Summarize name, status, and ids.',
  },
  {
    id: 'web',
    triggers: ['search the web', 'look up', 'google', 'what is', 'who is', 'find online', 'search online'],
    instruction:
      'Use web_search for factual lookups, then summarize the top results with sources.',
  },
  {
    id: 'video',
    triggers: ['make a video', 'promo video', 'create a video', 'video for', 'marketing video', 'promotional video', 'slideshow video'],
    instruction:
      'You can create narrated promo slideshow videos with the create_promo_video tool. ' +
      'Ask for (or infer) a title and slide lines; keep slides short and punchy for marketing. ' +
      'Report the output file path so Open-Chat can deliver it.',
  },
  {
    id: 'workspace',
    triggers: ['gmail', 'calendar', 'google drive', 'send an email via gmail', 'create an event', 'drive file', 'workspace'],
    instruction:
      'You have Gmail, Calendar, and Drive tools. Use gmail_send for email (prefer juicy subject/body), ' +
      'calendar_create_event for events, and drive_* for files. If Google is not authorized, tell the ' +
      'user to run node google-consent.mjs once.',
  },
];

export function matchSkills(message) {
  const text = String(message || '').toLowerCase();
  return SKILLS.filter((s) => s.triggers.some((t) => text.includes(t)));
}
