/*
 * The Marathi copy — the only file to edit when the final text arrives.
 *
 * Transcribed word for word from the handwritten draft. Where the draft ran a
 * sentence across several lines, it is split here into an array of lines; the
 * words and their order are unchanged (join the array with spaces to get the
 * sentence back). Splits exist only to set typographic hierarchy.
 *
 * Items marked CONFIRM are readings of the handwriting that need a yes from
 * the family. See README.md › "Copy to confirm".
 *
 * `signoff.names` is null because the names under आपले विनीत were redacted in
 * the draft. The layout reserves their space with neutral placeholder bars;
 * replace null with the real lines and the bars become text. Format:
 *   names: [
 *     ['left name', 'right name'],          // a pair on one row
 *     'a single centred line',              // e.g. वरील विनंतीस … line
 *     ['left name', 'right name'],
 *   ]
 */
window.PATRIKA_COPY = {
  page1: {
    invocations: [
      '॥ श्री जोगेश्वरी प्रसन्न ॥',
      '॥ श्री गजानन प्रसन्न ॥',
      '॥ श्री सप्तशृंगी प्रसन्न ॥',
    ],
    opening: 'स.न.वि.वि. आमचे येथे श्री कुलस्वामिनी कृपेकरून,',
    groom: {
      name: 'चि. समृद्ध',
      parents: ['(सौ. गायत्री व श्री. राहुल एकनाथ वावीकर', 'यांचे चिरंजीव)'], // CONFIRM: वावीकर
    },
    conjunction: 'आणि',
    bride: {
      name: 'चि. सौ. कां. वदन्या', // CONFIRM: वदन्या
      parents: ['(सौ. नीता व श्री निलेश वैद्य', 'यांची सुकन्या)'],
    },
    closing: 'यांचा',
    occasion: '॥ शुभ विवाह ॥',
  },

  page2: {
    // One sentence, broken so that the date and the muhurta carry the weight.
    // `em: true` lines are set larger. Words exactly as in the draft.
    muhurta: [
      { text: 'मिती पौष कृ. ८ शके १९४८' },
      { text: 'शुक्रवार दिनांक २९/१/२०२७', em: true },   // CONFIRM: separators drawn as | in the draft
      { text: 'रोजी १२ वाजून १४ मिनिटे', em: true },      // CONFIRM: no सकाळी/दुपारी in the draft
      { text: 'या शुभमुहूर्तावर करण्याचे योजिले आहे.' },
    ],
    request:
      'तरी आपण सहकुटुंब-सहपरिवार उपस्थित राहून वधू-वरांस शुभाशिर्वाद द्यावेत ही विनंती.', // CONFIRM: शुभाशिर्वाद as written
    signoff: {
      heading: 'आपले विनीत',
      names: null,
      // Shape of the redacted block in the draft: one pair, a two-line
      // centred note, then three pairs. Used only to size the placeholders.
      placeholderShape: ['pair', 'line', 'line', 'pair', 'pair', 'pair'],
    },
    venue: {
      heading: 'विवाह स्थळ :-',
      lines: [
        'राकाज् गुलाबनगरी',            // CONFIRM: first word is hard to read
        'प्रोफेसर कॉलनी, हनुमानवाडी',   // CONFIRM: one word or हनुमान वाडी
        'नाशिक - ४२२००३.',
      ],
    },
  },
};
