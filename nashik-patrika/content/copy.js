/*
 * The Marathi copy — the only file to edit when the text changes.
 *
 * Transcribed word for word from the handwritten draft. Where a sentence is
 * given as an array, it has only been broken into lines for the layout; the
 * words and their order are unchanged (join the lines with spaces to get the
 * draft back). Items marked CONFIRM are readings that need the family's yes.
 *
 * `signoff.names` is null because the names under आपले विनीत were blacked
 * out in the draft. Until they are supplied the layout holds their space with
 * faint bars (no invented text). Replace null with rows like:
 *   names: [
 *     ['left name', 'right name'],     // a pair on one row
 *     'a single centred line',         // e.g. a line of request
 *   ]
 */
window.PATRIKA_COPY = {
  invocations: [
    '॥ श्री जोगेश्वरी प्रसन्न ॥',
    '॥ श्री गजानन प्रसन्न ॥',
    '॥ श्री सप्तशृंगी प्रसन्न ॥',
  ],
  // one sentence, set on two lines
  opening: ['स.न.वि.वि.', 'आमचे येथे श्री कुलस्वामिनी कृपेकरून,'],
  groom: {
    name: 'चि. समृद्ध',
    parents: ['(सौ. गायत्री व श्री. राहुल एकनाथ वावीकर', 'यांचे चिरंजीव)'], // CONFIRM: वावीकर
  },
  conjunction: 'आणि',
  bride: {
    name: 'चि. सौ. कां. वदन्या', // CONFIRM: वदन्या
    parents: ['(सौ. नीता व श्री निलेश वैद्य यांची सुकन्या)'],
  },
  closing: 'यांचा',
  occasion: '॥ शुभ विवाह ॥',
  // the invitation, one paragraph, broken exactly where the family's
  // handwritten draft breaks its lines
  invitation: [
    'मिती पौष कृ. ८ शके १९४८ शुक्रवार दिनांक २९/१/२०२७', // CONFIRM: | written as /
    'रोजी १२ वाजून १४ मिनिटे या शुभमुहूर्तावर करण्याचे',   // CONFIRM: no सकाळी/दुपारी in draft
    'योजिले आहे. तरी आपण सहकुटुंब-सहपरिवार उपस्थित',
    'राहून वधू-वरांस शुभाशिर्वाद द्यावेत ही विनंती.',     // CONFIRM: शुभाशिर्वाद as written
  ],
  signoff: {
    heading: '* आपले विनीत *', // asterisks as in the draft
    names: null,
    // the shape of the blacked-out block in the draft: one pair, a two-line
    // centred note, three pairs — used only to size the reserved space
    placeholderShape: ['pair', 'line', 'line', 'pair', 'pair', 'pair'],
  },
  venue: {
    heading: 'विवाह स्थळ :-',
    lines: [
      'राकाज् गुलाबनगरी',            // CONFIRM: first word hard to read
      'प्रोफेसर कॉलनी, हनुमानवाडी',   // CONFIRM: one word or हनुमान वाडी
      'नाशिक - ४२२००३.',
    ],
  },
};
