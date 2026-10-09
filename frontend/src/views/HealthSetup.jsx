import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Section } from '../components/ui.jsx'
import { SEND_SHORTCUT, SYNC_SHORTCUT } from './Health.jsx'
import '../food.css'

// How to build the two Shortcuts that connect the app to Apple Health (views/Health.jsx). Written
// from Apple's Shortcuts actions; menu names move a little between iOS versions, which is why the
// app shows what it read before saving anything.

const Step = ({ n, children }) => <div className="fd-step"><span className="fd-step-n">{n}</span><div>{children}</div></div>

export default function HealthSetup() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: 28 }}>{t('Set up Apple Health')}</h1>
        <div className="sub">{t('Two Shortcuts, about 10 minutes, once')}</div>
      </div>
    </div>

    <div className="card small" style={{ lineHeight: 1.5 }}>
      {t('iPhone web apps cannot read Apple Health directly, so the Shortcuts app does it: one Shortcut copies your numbers for the app to paste, the other logs your food into Health. Your Apple Watch already records into Health, so its steps, exercise and heart rate come along.')}
    </div>

    <Section title={t('1 · “{0}” — Health into the app', SYNC_SHORTCUT)}>
      <div className="card small fd-steps" style={{ margin: 0 }}>
        <Step n="1">{t('Open the Shortcuts app, tap +, and name the new shortcut exactly')} <b>{SYNC_SHORTCUT}</b>.</Step>
        <Step n="2">{t('Add the action “Find Health Samples”. Set Type to Steps, Start Date to “is today”, and Group By to Day. Grouping by day gives the same total as the Health app, without counting your phone and watch twice.')}</Step>
        <Step n="3">{t('Add the same action again for each of these, same settings: Exercise Minutes, Active Energy, Resting Heart Rate. Skip any you do not care about.')}</Step>
        <Step n="4">{t('For weight, add “Find Health Samples” with Type Weight, Sort by Start Date, Order Latest First, Limit 1.')}</Step>
        <Step n="5">{t('Optional, sleep: add “Find Health Samples” with Type Sleep Analysis and Start Date “is in the last 1 days”, then “Calculate Statistics” → Sum of their Duration.')}</Step>
        <Step n="6">{t('Add a “Text” action and type the lines below, inserting each result as a variable after its colon (tap the variable bar above the keyboard):')}
          <pre className="fd-code">{'openGym\nSteps: [Steps]\nExercise: [Exercise Minutes]\nActive Energy: [Active Energy]\nResting Heart Rate: [Resting Heart Rate]\nWeight: [Weight]\nSleep: [Statistics]'}</pre>
        </Step>
        <Step n="7">{t('Add “Copy to Clipboard”. That is the whole shortcut.')}</Step>
        <Step n="8">{t('In openGym, open Health and tap Get data: the shortcut runs. Come back, tap Paste, and tap Paste again on the bubble iOS shows. Check the numbers against the Health app the first time, then Save.')}</Step>
      </div>
    </Section>

    <Section title={t('2 · “{0}” — food into Health', SEND_SHORTCUT)}>
      <div className="card small fd-steps" style={{ margin: 0 }}>
        <Step n="1">{t('New shortcut, named exactly')} <b>{SEND_SHORTCUT}</b>.</Step>
        <Step n="2">{t('Add “Get Dictionary from Input” — the input is the Shortcut Input, which the app sends.')}</Step>
        <Step n="3">{t('Add “Get Dictionary Value”: Get Value for key kcal in Dictionary.')}</Step>
        <Step n="4">{t('Add “Log Health Sample”: Type Dietary Energy, Value the Dictionary Value, unit kcal, Date Current Date.')}</Step>
        <Step n="5">{t('Repeat steps 3–4 for each key and type: protein → Protein, carbs → Carbohydrates, fat → Total Fat, fiber → Fiber, sugar → Dietary Sugar (all in grams).')}</Step>
        <Step n="6">{t('In openGym, tap “Send today’s food to Health” once a day, after your last meal. Health adds every send, so the app warns you before sending the same day twice.')}</Step>
      </div>
    </Section>

    <Section title={t('Make it automatic (optional)')}>
      <div className="card small fd-steps" style={{ margin: 0 }}>
        <Step n="•">{t('Shortcuts → Automation → + → Time of Day, e.g. 9 PM daily → Run Immediately → Run Shortcut → {0}. The numbers wait on your clipboard; tap Paste next time you open Health in the app.', SYNC_SHORTCUT)}</Step>
        <Step n="•">{t('The first time a Shortcut reads Health, iOS asks which data it may read. Allow the ones you added.')}</Step>
      </div>
    </Section>
  </div>
}
