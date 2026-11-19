import type { Skill } from './types.js';

const MAX_CHARS = 3200; // about 800 tokens

export interface SkillSection {
  skill: string;
  /** builtin | user | repo — third-party text must be fenced as untrusted data by whoever puts it in a prompt. */
  source: string;
  license: string | null;
  section: string;
  text: string;
}

/** The one guidance section that matches a finding category, capped for use inside AI prompts and MCP replies. */
export function selectSkillSection(skills: Skill[], category: string, section = 'Verification checklist'): SkillSection | null {
  for (const skill of skills) {
    if (!skill.meta.categories.includes(category)) continue;
    const text = skill.sections[section];
    if (text) return { skill: skill.meta.name, source: skill.source, license: skill.meta.license ?? null, section, text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text };
  }
  return null;
}
