// Email: transports selected by EMAIL_PROVIDER, React Email templates and the suppression list.
export { consoleTransport } from './console-transport.ts';
export { emailErrorCode, isPermanentEmailError } from './errors.ts';
export { getTranslator, toEmailLocale, type EmailLocale, type Translate } from './messages.ts';
export {
  isMandatoryTemplate,
  preferencesUrl,
  renderEmail,
  TEMPLATE_NAMES,
  TEMPLATES,
  type RenderedEmail,
  type TemplateName,
  type TemplateProps,
} from './render.ts';
export { SES_DEFAULT_REGION, SES_INDIA_REGIONS, sesTransport } from './ses-transport.ts';
export { smtpTransport } from './smtp-transport.ts';
export {
  handleSesEvent,
  isSuppressed,
  recordSuppression,
  type SesEvent,
  type SuppressionReason,
} from './suppression.ts';
export {
  createEmailTransport,
  DEFAULT_FROM,
  type EmailLogger,
  type EmailMessage,
  type EmailTransport,
  type EmailTransportEnv,
} from './transport.ts';
