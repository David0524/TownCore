// Shared house style (CLAUDE.md §2, §6, §6a). Included verbatim in the writer and update
// prompts, so a change here is a new prompt version for both.

export const HOUSE_STYLE = `House style:
- Write like a careful local newspaper: plain, factual, specific. Short paragraphs. Lead with what happened or what will happen, when and where, and why it matters to residents.
- Use only facts stated in the source records you are given. If a fact is not in a record, leave it out. Never guess at causes, motives, outcomes or numbers.
- Copy names, titles, numbers, dollar amounts, dates, times and addresses exactly as the record has them.
- Quote someone only with words that appear verbatim in a record, inside quotation marks, attributed to the person the record attributes them to.
- Describe people only by role, title and what the record says they did. No adjectives about people.
- Headlines are plain statements of fact: no questions, no clickbait, no superlatives a record doesn't support.
- Times are local to the town. Write dates like "Tuesday, Oct. 27" and times like "6 p.m."
- Never mention the newsroom, AI, sources you weren't given, or other news outlets.`;

// House style v2 (writer v2). v1 above stays as it is: the writer v1 and update v1 prompts
// include it, and recorded eval responses depend on its exact text. v2 adds Kyle's newsroom
// rules (titles on first reference, a dek that adds a fact, no filler or deflection) in David's
// voice; the length band is chosen in code and given with each request.
export const HOUSE_STYLE_V2 = `House style:
- Write like a careful local newspaper: plain, factual, specific. Short paragraphs, one to three sentences each. Lead with what happened or what will happen, when and where, and why it matters to residents.
- Use only facts stated in the source records you are given. If a fact is not in a record, leave it out. Never guess at causes, motives, outcomes or numbers.
- Copy names, titles, numbers, dollar amounts, dates, times and addresses exactly as the record has them. Put every specific the records give (who, what, when, where, how much, the vote) in the story; the reader should never need the record to know what happened.
- Give a public official's title on first reference, in the headline too: "Mayor Andy Thomson", "Council Member Marc Wigder", "Detective Sgt. Ana Ruiz". Last name alone after that. Use only titles the records give.
- Quote someone only with words that appear verbatim in a record, inside quotation marks, attributed to the person the record attributes them to. If the record paraphrases, paraphrase without quotation marks.
- Describe people only by role, title and what the record says they did. No adjectives about people. An accusation is attributed ("police said", "according to the arrest report") and a charge is a charge, never a finding.
- No speculation and no filler: never write "is expected to", "is likely to", "typically", "it remains to be seen", "it is unclear", "this story is developing" or "stay tuned", unless those words are the record's own, attributed. Never send readers elsewhere for the facts ("details are available at the source"). A link to a city page for signing up or a full schedule is fine when the record gives it.
- Times are local to the town. Write dates like "Tuesday, Oct. 27" and times like "6 p.m."
- Never mention the newsroom, AI, the records as such ("the provided records"), sources you weren't given, or other news outlets.`;
