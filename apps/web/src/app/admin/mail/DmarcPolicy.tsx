import type { AdminPillTone } from '@towncore/config';
import { STEP_UP, type DmarcPolicy, type PolicyAdvice } from '@towncore/mail';
import styles from '../admin.module.css';
import { Pill } from '../Pill';
import { setDmarcPolicyAction } from './deliverability-actions';

// DMARC policy per record, with whether the reports say it can step up (owner, 2026-10-19):
// p=none → quarantine → reject. Shown in Mail health and on each domain's page.

const POLICY_TONE: Record<DmarcPolicy, AdminPillTone> = {
  none: 'gray',
  quarantine: 'blue',
  reject: 'green',
};

export function DmarcPolicyTable({
  advice,
  isAdmin,
  from,
  domainName,
}: {
  advice: PolicyAdvice[];
  isAdmin: boolean;
  from: 'health' | 'domain';
  domainName?: string;
}) {
  if (advice.length === 0)
    return (
      <p className={styles.muted} data-testid="dmarc-policy">
        No DMARC records yet. Onboarding writes them at p=none.
      </p>
    );
  return (
    <>
      <p className={styles.muted}>
        Every record starts at p=none, so receivers only report. A record is ready for the next step
        after {STEP_UP.minReportDays} days of reports, {STEP_UP.minMessages} messages and{' '}
        {STEP_UP.minPassRate * 100}% passing DMARC in the last {STEP_UP.windowDays} days, and reject
        waits {STEP_UP.minDaysAtQuarantine} days at quarantine.
      </p>
      <div className={styles.scroll}>
        <table className={styles.table} data-testid="dmarc-policy">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Policy</th>
              <th>Next step</th>
              <th>Reports</th>
              {isAdmin ? <th>Change</th> : null}
            </tr>
          </thead>
          <tbody>
            {advice.map((a) => (
              <tr key={a.recordId} data-governs={a.governs}>
                <td className={styles.mono}>{a.governs}</td>
                <td>
                  {a.current ? (
                    <Pill tone={POLICY_TONE[a.current]}>{a.current}</Pill>
                  ) : (
                    <Pill tone="red">missing</Pill>
                  )}
                  <div className={styles.small}>
                    since {a.policySince.toISOString().slice(0, 10)}
                  </div>
                </td>
                <td>
                  {a.next ? (
                    a.ready ? (
                      <Pill tone="green">{`Ready for ${a.next}`}</Pill>
                    ) : (
                      <Pill tone="amber">{`Not yet ready for ${a.next}`}</Pill>
                    )
                  ) : (
                    <span className={styles.muted}>None; strictest</span>
                  )}
                  {a.next ? (
                    <ul className={styles.reasons}>
                      {a.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className={styles.num}>
                  {a.stats.messages.toLocaleString('en-US')} messages
                  <div className={styles.small}>
                    {a.stats.reportDays} days ·{' '}
                    {a.stats.messages
                      ? `${((a.stats.dmarcPass / a.stats.messages) * 100).toFixed(1)}% pass`
                      : 'no data'}
                  </div>
                </td>
                {isAdmin ? (
                  <td>
                    {a.editable ? (
                      <div className={styles.actions}>
                        {a.next && a.ready ? (
                          <PolicyButton advice={a} to={a.next} from={from} domain={domainName} />
                        ) : null}
                        {a.current && a.current !== 'none' ? (
                          <PolicyButton
                            advice={a}
                            to="none"
                            from={from}
                            domain={domainName}
                            secondary
                          />
                        ) : null}
                      </div>
                    ) : (
                      <span className={styles.small}>
                        Not created by us; change it at the DNS host.
                      </span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PolicyButton({
  advice,
  to,
  from,
  domain,
  secondary,
}: {
  advice: PolicyAdvice;
  to: DmarcPolicy;
  from: 'health' | 'domain';
  domain?: string;
  secondary?: boolean;
}) {
  return (
    <form action={setDmarcPolicyAction}>
      <input type="hidden" name="recordId" value={advice.recordId} />
      <input type="hidden" name="policy" value={to} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="name" value={domain ?? advice.domain} />
      <button className={secondary ? `${styles.button} ${styles.secondary}` : styles.button}>
        {to === 'none' ? 'Back to none' : `Move to ${to}`}
      </button>
    </form>
  );
}
