import { receiptCheckExplain } from '../lib/receiptCheckCore.mjs';

/** Receipt check copy. ReceiptCheck.tsx and the static HTML generator both read this. */

const explain = receiptCheckExplain();

export const checkContent = {
  h1: 'Receipt check',
  kicker: 'Free · no account',
  intro:
    'Paste a receipt, a receipt id, or a receipt URL. The verdict is the same text chit402-verify prints.',
  description:
    'Paste a receipt, a receipt id, or a receipt URL. Free. The verdict matches chit402-verify.',
  fieldLabel: 'Receipt',
  placeholder: 'Paste the receipt JSON, or a receipt id or URL',
  submit: 'Check',
  pending: 'Checking',
  verifyHref: '/docs/verify',
  verifyLabel: 'What the verdict means',
  historyHref: '/docs/receipt-check',
  historyLabel: 'Hash and key history',
  acceptedHeading: 'Accepted input',
  feedbackPublic: "Notes are posted publicly as GitHub issues. Don't include private info.",
  feedbackOpen: 'Something wrong? Tell us',
  expectedLabel: 'What did you expect?',
  expectedOptions: ['Choose', 'verified', 'invalid', 'other'],
  intentLabel: 'What were you trying to do?',
  noteLabel: 'Note',
  attachLabel: 'Attach the receipt I pasted so the team can reproduce it',
  send: 'Send',
  sending: 'Sending',
  sent: 'Sent.',
  notFiled: 'Feedback was not filed.',
  exampleLabel: 'Example',
  couldNot: explain.couldNot,
  tryAgain: explain.tryAgain,
  explain,
};

export function checkStaticModel() {
  const copy = checkContent;
  const hints = copy.explain;
  return {
    h1: copy.h1,
    sections: [
      {
        heading: copy.fieldLabel,
        paragraphs: [copy.kicker, copy.intro, copy.description, copy.placeholder, copy.submit, copy.pending],
        links: [
          { href: copy.verifyHref, label: copy.verifyLabel },
          { href: copy.historyHref, label: copy.historyLabel },
        ],
      },
      {
        heading: copy.acceptedHeading,
        paragraphs: [
          hints.inputErrorTitle,
          hints.inputHint,
          hints.accepted.join(', '),
          hints.shorter,
          hints.wait,
          hints.notInLog,
          hints.pasteSigned,
          hints.couldNot,
          hints.tryAgain,
          hints.slowDown,
          hints.tooLarge,
          `${copy.exampleLabel}: ${hints.example}`,
        ],
      },
      {
        heading: copy.feedbackOpen,
        paragraphs: [
          copy.feedbackPublic,
          copy.expectedLabel,
          copy.expectedOptions.join(', '),
          copy.intentLabel,
          copy.noteLabel,
          copy.attachLabel,
          copy.send,
          copy.sending,
          copy.sent,
          copy.notFiled,
        ],
      },
    ],
  };
}
