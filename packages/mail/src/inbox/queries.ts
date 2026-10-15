import {
  and,
  asc,
  attachments,
  contacts,
  desc,
  eq,
  inArray,
  isNull,
  mailDomains,
  messages,
  notes,
  or,
  sql,
  staff,
  teamMembers,
  teams,
  threadReads,
  threads,
  type Db,
  type SQL,
} from '@towncore/db';

// The shared inbox (Mail-3): filters, search, per-person unread state. A few thousand threads
// is the design size; every filter uses an index and search is a plain ILIKE.

export const threadStatuses = ['open', 'pending', 'closed', 'spam'] as const;
export type ThreadStatus = (typeof threadStatuses)[number];
/** "active" = open + pending, the default view. */
export type StatusFilter = ThreadStatus | 'active' | 'all';

export type InboxFilter = {
  teamId?: string;
  domainId?: string;
  /** 'me', 'none' (unassigned), or a staff id. */
  assignee?: string;
  status?: StatusFilter;
  q?: string;
  unreadOnly?: boolean;
  page?: number;
};

export const PAGE_SIZE = 50;

export type InboxRow = {
  id: string;
  subject: string;
  status: ThreadStatus;
  townAddress: string;
  domainName: string;
  teamName: string;
  assigneeName: string | null;
  contactEmail: string;
  contactName: string | null;
  lastMessageAt: Date;
  messageCount: number;
  snippet: string | null;
  unread: boolean;
};

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

function unreadExpr() {
  return sql<boolean>`(${threadReads.readAt} is null or ${threads.lastMessageAt} > ${threadReads.readAt})`;
}

function conditions(staffId: string, f: InboxFilter): SQL[] {
  const where: SQL[] = [];
  const status = f.status ?? 'active';
  if (status === 'active') where.push(inArray(threads.status, ['open', 'pending']));
  else if (status !== 'all') where.push(eq(threads.status, status));
  if (f.teamId) where.push(eq(threads.teamId, f.teamId));
  if (f.domainId) where.push(eq(threads.domainId, f.domainId));
  if (f.assignee === 'me') where.push(eq(threads.assigneeId, staffId));
  else if (f.assignee === 'none') where.push(isNull(threads.assigneeId));
  else if (f.assignee) where.push(eq(threads.assigneeId, f.assignee));
  const q = f.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      or(
        sql`${threads.subject} ilike ${like}`,
        sql`${contacts.email} ilike ${like}`,
        sql`${contacts.name} ilike ${like}`,
        sql`${mailDomains.name} ilike ${like}`,
        sql`${threads.townAddress} ilike ${like}`,
      )!,
    );
  }
  if (f.unreadOnly) where.push(unreadExpr());
  return where;
}

export async function listThreads(
  db: Db,
  staffId: string,
  filter: InboxFilter = {},
): Promise<{ rows: InboxRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const where = and(...conditions(staffId, filter));
  const base = db
    .select({
      id: threads.id,
      subject: threads.subject,
      status: threads.status,
      townAddress: threads.townAddress,
      domainName: mailDomains.name,
      teamName: teams.name,
      assigneeName: staff.name,
      contactEmail: contacts.email,
      contactName: contacts.name,
      lastMessageAt: threads.lastMessageAt,
      messageCount: sql<number>`(select count(*)::int from ${messages} m where m.thread_id = ${threads.id})`,
      snippet: sql<string | null>`(
        select left(regexp_replace(coalesce(m.text_body, ''), '\\s+', ' ', 'g'), 160)
        from ${messages} m where m.thread_id = ${threads.id}
        order by m.sent_at desc limit 1)`,
      unread: unreadExpr(),
    })
    .from(threads)
    .innerJoin(mailDomains, eq(threads.domainId, mailDomains.id))
    .innerJoin(teams, eq(threads.teamId, teams.id))
    .innerJoin(contacts, eq(threads.contactId, contacts.id))
    .leftJoin(staff, eq(threads.assigneeId, staff.id))
    .leftJoin(
      threadReads,
      and(eq(threadReads.threadId, threads.id), eq(threadReads.staffId, staffId)),
    );
  const [rows, [count]] = await Promise.all([
    base
      .where(where)
      .orderBy(desc(threads.lastMessageAt), desc(threads.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(threads)
      .innerJoin(mailDomains, eq(threads.domainId, mailDomains.id))
      .innerJoin(contacts, eq(threads.contactId, contacts.id))
      .leftJoin(
        threadReads,
        and(eq(threadReads.threadId, threads.id), eq(threadReads.staffId, staffId)),
      )
      .where(where),
  ]);
  return { rows: rows as InboxRow[], total: count?.n ?? 0, page, pageSize: PAGE_SIZE };
}

/**
 * Unread open or pending threads for this person: in their teams, or in every team if they
 * belong to none yet. Shown as the count next to "Inbox".
 */
export async function unreadCount(db: Db, staffId: string): Promise<number> {
  const mine = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.staffId, staffId));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threads)
    .leftJoin(
      threadReads,
      and(eq(threadReads.threadId, threads.id), eq(threadReads.staffId, staffId)),
    )
    .where(
      and(
        inArray(threads.status, ['open', 'pending']),
        mine.length
          ? inArray(
              threads.teamId,
              mine.map((m) => m.teamId),
            )
          : undefined,
        unreadExpr(),
      ),
    );
  return row?.n ?? 0;
}

export async function markRead(
  db: Db,
  threadId: string,
  staffId: string,
  at = new Date(),
): Promise<void> {
  await db
    .insert(threadReads)
    .values({ threadId, staffId, readAt: at })
    .onConflictDoUpdate({
      target: [threadReads.threadId, threadReads.staffId],
      set: { readAt: sql`greatest(${threadReads.readAt}, excluded.read_at)` },
    });
}

export async function getThread(db: Db, id: string) {
  const [head] = await db
    .select({
      thread: threads,
      domainName: mailDomains.name,
      displayName: mailDomains.displayName,
      teamName: teams.name,
      assigneeName: staff.name,
      contactEmail: contacts.email,
      contactName: contacts.name,
    })
    .from(threads)
    .innerJoin(mailDomains, eq(threads.domainId, mailDomains.id))
    .innerJoin(teams, eq(threads.teamId, teams.id))
    .innerJoin(contacts, eq(threads.contactId, contacts.id))
    .leftJoin(staff, eq(threads.assigneeId, staff.id))
    .where(eq(threads.id, id));
  if (!head) return null;
  const [msgs, files, threadNotes] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(eq(messages.threadId, id))
      .orderBy(asc(messages.sentAt), asc(messages.createdAt)),
    db
      .select()
      .from(attachments)
      .innerJoin(messages, eq(attachments.messageId, messages.id))
      .where(eq(messages.threadId, id))
      .orderBy(asc(attachments.position)),
    db
      .select({ note: notes, staffName: staff.name })
      .from(notes)
      .innerJoin(staff, eq(notes.staffId, staff.id))
      .where(eq(notes.threadId, id))
      .orderBy(asc(notes.createdAt)),
  ]);
  const byMessage = new Map<string, (typeof attachments.$inferSelect)[]>();
  for (const { attachments: a } of files)
    byMessage.set(a.messageId, [...(byMessage.get(a.messageId) ?? []), a]);
  return {
    ...head,
    messages: msgs.map((m) => ({ ...m, attachments: byMessage.get(m.id) ?? [] })),
    notes: threadNotes,
  };
}
export type ThreadDetail = NonNullable<Awaited<ReturnType<typeof getThread>>>;

/** Filter choices for the inbox: teams, live domains, active staff. */
export async function inboxFacets(db: Db) {
  const [teamRows, domainRows, staffRows] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(asc(teams.name)),
    db
      .select({ id: mailDomains.id, name: mailDomains.name })
      .from(mailDomains)
      .orderBy(asc(mailDomains.name)),
    db
      .select({ id: staff.id, name: staff.name, email: staff.email })
      .from(staff)
      .where(eq(staff.active, true))
      .orderBy(asc(staff.name)),
  ]);
  return { teams: teamRows, domains: domainRows, staff: staffRows };
}
