// ----------------------------------------------------------------------------
// Welcome Desk Check-In — configuration
// Edit these values to match your form. No other file needs changing.
// ----------------------------------------------------------------------------
window.CHECKIN_CONFIG = {
  // Options for the "ID Type" dropdown — must match the exact strings your
  // Google Form / Sheet expects.
  idTypes: [
    "WRLC University Card",
    "Catholic U Alumni",
    "Washington Theological Consortium ID Card",
    "US State ID / Driver's License",
    "Other College / University ID",
    "High School ID",
    "International ID / Passport",
    "Common Access Card (US Federal Government / Military)",
    "Other US Government IDs",
    "Other ID (Must get approval before using)",
  ],

  // When an ID Type below is chosen, a second dropdown appears under it.
  // Picking an option fills the Card Issuer field. Add more types freely.
  subLists: {
    "WRLC University Card": {
      label: "WRLC School",
      placeholder: "Choose school…",
      options: [
        "American University",
        "The Catholic University of America",
        "Gallaudet University",
        "George Mason University",
        "The George Washington University",
        "Georgetown University",
        "Howard University",
        "Marymount University",
        "University of the District of Columbia",
      ],
    },
    "Washington Theological Consortium ID Card": {
      label: "Member School",
      placeholder: "Choose school…",
      options: [
        "Byzantine Catholic Seminary",
        "Catholic University of America School of Theology",
        "Howard University School of Divinity",
        "John Leland Center for Theological Studies",
        "Pontifical Faculty of the Immaculate Conception (Dominican House of Studies)",
        "Reformed Theological Seminary – DC",
        "United Lutheran Seminary",
        "Virginia Theological Seminary",
        "Virginia Union University School of Theology",
        "Wesley Theological Seminary",
      ],
    },
    "US State ID / Driver's License": {
      label: "Issuing State / Territory",
      placeholder: "Choose state…",
      options: [
        "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
        "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
        "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
        "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
        "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
        "New Hampshire", "New Jersey", "New Mexico", "New York",
        "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
        "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
        "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
        "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
        "Puerto Rico", "Guam", "U.S. Virgin Islands", "American Samoa",
        "Northern Mariana Islands",
      ],
    },
  },

  // Pre-filled defaults so staff rarely have to type these.
  // Card Issuer varies too much here (school name, state, country) to default,
  // so it's left blank; Expiration defaults to "NA" since many cards lack one.
  defaults: {
    cardIssuer: "",
    expiration: "NA",
  },

  // How many recent check-ins to show on screen.
  recentLimit: 8,
};
