import { localized, React } from 'mailspring-exports';
import * as OnboardingActions from './onboarding-actions';

/**
 * Replaces the vendor's onboarding webview.
 *
 * Upstream loads `${identityServer}/onboarding?...` in a Webview, so the first-run screens are
 * HTML served by the vendor's identity service — including a step threatening to disable features
 * unless you create an account. Nuncio has no identity server and no cloud: that page would be a
 * remote dependency, and its warning would be false here, so the step is local and describes what
 * this build can actually do.
 *
 * The onboarding store only needs one thing from this page: identityJSONReceived with
 * `{ skipped: true }` clears any stored identity and moves on to account setup. The copy never
 * mentions the upstream product by name — users of this build should not have to care about it.
 *
 * Layout lives in styles/onboarding.less under `.page.identity-skip`; `.page.authenticate` is
 * left alone because upstream's rule assumes a webview child that fills the page.
 */
export default class AuthenticatePage extends React.Component<{ account?: object }> {
  static displayName = 'AuthenticatePage';

  _onContinue = () => {
    OnboardingActions.identityJSONReceived({ skipped: true });
  };

  render() {
    return (
      <div className="page identity-skip">
        <div className="content">
          <h1>{localized('No account, no cloud')}</h1>
          <p className="lede">
            {localized(
              'Nuncio keeps your mail on this machine. No sign-up, no subscription — here is what works right away.'
            )}
          </p>
          <div className="feature-columns">
            <div className="feature-column">
              <h4>{localized('Works right away')}</h4>
              <ul>
                <li>{localized('Unified inbox, search, rules, templates')}</li>
                <li>{localized('Snooze, send later, reminders, undo send')}</li>
                <li>{localized('Open and link tracking via your own server')}</li>
                <li>{localized('Activity, signatures, multiple accounts')}</li>
              </ul>
            </div>
            <div className="feature-column">
              <h4>{localized('Not in this build')}</h4>
              <ul>
                <li>{localized('Message translation')}</li>
                <li>{localized('Contact and company profiles')}</li>
                <li>{localized('Thread sharing')}</li>
              </ul>
              <p className="note">
                {localized('These need a server component that this build does not include.')}
              </p>
            </div>
          </div>
        </div>
        <div className="footer">
          <button className="btn btn-large btn-emphasis btn-continue" onClick={this._onContinue}>
            {localized('Continue')}
          </button>
        </div>
      </div>
    );
  }
}
