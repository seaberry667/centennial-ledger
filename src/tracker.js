'use strict';
/**
 * Colorado Federal Lawsuit Tracker — a perennial guide filed under
 * Politics (owner-supplied text, 2026-11-23; source text kept at
 * goals/colorado-conservative-news-site/files/
 * colorado-federal-lawsuit-tracker-source.md). Rendered as a
 * designed page rather than a standard article. News-graphics
 * redesign (owner order, 2026-11-27 — the original table-and-cards
 * layout read as stodgy): a dark scoreboard with a segmented record
 * bar, count-up stats and per-case tiles; a filterable case
 * explorer in place of the status table; Supreme Court cards on a
 * year timeline with justice-dot vote graphics; and an animated
 * taxpayer-cost bar chart. All copy and data are unchanged from the
 * owner's text. Helpers (layout, esc, ad slots) are passed in from
 * render.js so this module stays self-contained.
 */

const TRACKER_PATH = '/politics/federal-lawsuit-tracker';
const UPDATED = 'November 27, 2026';

/* Status table rows: [case, court and year, status, chip kind].
   Chip kinds: loss (red), win (navy), pending (gold), mixed (red —
   the mixed postures here still went against Colorado; owner order
   2026-11-23: red like a loss, not gray). */
const STATUS_ROWS = [
  ['Romer v. Evans', 'U.S. Supreme Court, 1996', "Colorado's Amendment 2 struck down, 6–3", 'loss', 'romer-v-evans'],
  ['Coalition for Secular Government v. Williams', 'Tenth Circuit, 2016', "Colorado's disclosure rules held unconstitutional as applied", 'loss', 'coalition-for-secular-government-v-williams'],
  ['Masterpiece Cakeshop v. Colorado Civil Rights Commission', 'U.S. Supreme Court, 2018', 'Colorado lost, 7–2', 'loss', 'masterpiece-cakeshop'],
  ['Colorado Department of State v. Baca', 'U.S. Supreme Court, 2020', 'Colorado prevailed, 8–0', 'win', 'colorado-department-of-state-v-baca'],
  ['303 Creative LLC v. Elenis', 'U.S. Supreme Court, 2023', 'Colorado lost, 6–3', 'loss', '303-creative-llc-v-elenis'],
  ['Trump v. Anderson', 'U.S. Supreme Court, 2024', 'Colorado Supreme Court reversed, 9–0', 'loss', 'trump-v-anderson'],
  ['Darren Patterson Christian Academy v. Roy', 'Federal district court, 2025', 'School prevailed; state appeal paused', 'mixed', 'darren-patterson-christian-academy-v-roy'],
  ['Bella Health and Wellness v. Weiser', 'Federal district court, 2025', 'Permanent injunction; $6.1 million settlement', 'loss', 'bella-health-and-wellness-v-weiser'],
  ['NetChoice v. Weiser', 'Federal district court, 2025', 'Preliminary injunction against Colorado', 'mixed', 'netchoice-v-weiser'],
  ['Chiles v. Salazar', 'U.S. Supreme Court, 2026', "Colorado's position rejected, 8–1; remanded", 'loss', 'chiles-v-salazar'],
  ['St. Mary Catholic Parish v. Roy', 'U.S. Supreme Court, 2026', 'Argued November 3; decision pending', 'pending', 'st-mary-catholic-parish-v-roy'],
  ['HB25-1312 constitutional challenges', 'Federal district and appellate courts, 2025–26', 'Litigation and injunction appeals pending', 'pending', 'hb25-1312-challenges'],
];

const INTRO = [
  'Colorado has become something of a repeat customer at the United States Supreme Court. From forcing Christian business owners to defend their religious convictions to attempting to regulate what licensed counselors may say, state officials have repeatedly pushed constitutional boundaries, only to find federal judges standing in their way.',
  "The state's legal history includes some extraordinary defeats. The Supreme Court ruled 7–2 against Colorado in Masterpiece Cakeshop, 6–3 in 303 Creative, and 8–1 in Chiles v. Salazar. In 2024, all nine justices reversed a Colorado Supreme Court decision removing Donald Trump from the state's presidential primary ballot.",
  'And the litigation continues.',
  'Colorado is currently defending its Universal Preschool requirements against religious-liberty challenges, fighting over compelled speech in social-media regulation, and facing lawsuits concerning its treatment of chosen names and gender identity under state antidiscrimination law.',
  "The consequences go beyond legal arguments. Colorado has agreed to pay more than $7.82 million in opposing attorneys' fees in just three documented constitutional disputes. That figure excludes the state's own legal expenses and the unresolved costs of other cases.",
  'There is a recurring question worth asking: Why do Colorado officials keep pursuing policies that run into serious constitutional objections, even after the courts have repeatedly warned them about the limits of government power?',
  'This tracker follows the evidence: what Colorado tried to do, who challenged it, what the courts actually decided, and what the resulting litigation has cost taxpayers.',
  "Not every lawsuit is a final defeat, and not every historical case reflects the priorities of today's political leadership. The distinction is important. A credible accounting of Colorado's constitutional record should be built from judicial decisions, not campaign slogans.",
];

/* Case cards. sections: [heading, [paragraphs]]. vote: [majority,
   minority] with voteNote; null vote renders the pending treatment. */
const SCOTUS_CASES = [
  {
    n: 1, id: 'romer-v-evans', name: 'Romer v. Evans', year: '1996',
    outcome: "Colorado's Amendment 2 struck down, 6–3", chip: 'loss',
    vote: [6, 3], voteNote: '6–3 against Colorado',
    meta: [
      ['Constitutional issue', 'Fourteenth Amendment, Equal Protection Clause'],
      ['Decision', 'May 20, 1996'],
    ],
    sections: [
      ['What happened', [
        'In 1992, Colorado voters approved Amendment 2, which prohibited state and local governments from adopting protections against discrimination based on homosexual, lesbian, or bisexual orientation.',
        'Opponents challenged the amendment, arguing that it singled out a particular group and denied its members equal protection under the law.',
        'The Colorado Supreme Court blocked enforcement, and the case reached the United States Supreme Court.',
      ]],
      ['What the Supreme Court decided', [
        'In a 6–3 ruling, the Court held that Amendment 2 violated the Equal Protection Clause.',
        'Writing for the majority, Justice Anthony Kennedy concluded that the amendment imposed an unusually broad disability on one identifiable group without a sufficient constitutional justification.',
        'The decision established that a voter-approved state constitutional amendment remains subject to the protections of the United States Constitution.',
      ]],
      ['Why it matters', [
        "Romer is an important part of Colorado's constitutional history, although it arose from a different political era and a different set of policy objectives than the state's recent religious-liberty litigation.",
        'It illustrates a basic constitutional limit: even a majority of voters cannot place restrictions in a state constitution that violate federal equal-protection guarantees.',
      ]],
    ],
    source: 'Primary source: U.S. Supreme Court opinion, Romer v. Evans, 517 U.S. 620 (1996)',
  },
  {
    n: 2, id: 'masterpiece-cakeshop', name: 'Masterpiece Cakeshop v. Colorado Civil Rights Commission', year: '2018',
    outcome: 'Colorado lost, 7–2', chip: 'loss',
    vote: [7, 2], voteNote: '7–2 against Colorado',
    meta: [
      ['Constitutional issue', 'First Amendment, Free Exercise Clause'],
      ['Decision', 'June 4, 2018'],
    ],
    sections: [
      ['What happened', [
        'Jack Phillips, the Christian owner of Masterpiece Cakeshop in Lakewood, declined to create a custom wedding cake for a same-sex wedding because of his religious convictions.',
        "He offered to sell the couple other baked goods, but Colorado's Civil Rights Commission concluded that his refusal to create the wedding cake violated the Colorado Anti-Discrimination Act.",
        'Phillips challenged the decision, arguing that Colorado had violated his constitutional rights.',
      ]],
      ['What the Supreme Court decided', [
        "The Supreme Court ruled 7–2 in Phillips' favor.",
        'The majority found that Colorado officials had failed to consider his religious objections with the neutrality required by the First Amendment.',
        "The Court highlighted commissioners' statements disparaging religious beliefs and the state's inconsistent treatment of similar conscience-based objections.",
        "The decision did not create a blanket exemption allowing businesses to discriminate against gay customers. It addressed the government's treatment of Phillips during the particular enforcement proceedings.",
      ]],
      ['Why it matters', [
        "Colorado's Civil Rights Commission was required to enforce the law without hostility toward religion. The Supreme Court found that it had failed to meet that standard.",
        'This was an especially significant constitutional rebuke because the violation arose not merely from the text of a law, but from the behavior of the government officials enforcing it.',
        'The lesson should have been straightforward: Government agencies do not get to decide that religious convictions deserve less respect because officials dislike the beliefs behind them.',
      ]],
    ],
    source: 'Primary source: U.S. Supreme Court opinion, Masterpiece Cakeshop, 584 U.S. 617 (2018)',
  },
  {
    n: 3, id: 'colorado-department-of-state-v-baca', name: 'Colorado Department of State v. Baca', year: '2020',
    outcome: 'Colorado prevailed, 8–0', chip: 'win',
    vote: [8, 0], voteNote: '8–0 for Colorado',
    meta: [
      ['Constitutional issue', 'Presidential electors and state authority'],
      ['Decision', 'July 6, 2020'],
    ],
    sections: [
      ['What happened', [
        "During the 2016 presidential election, Colorado presidential elector Micheal Baca attempted to cast his Electoral College vote for John Kasich rather than Hillary Clinton, who had won the state's popular vote.",
        'Colorado removed him as an elector and replaced him with someone who voted in accordance with state requirements.',
        "Baca challenged the state's authority to control how presidential electors cast their votes.",
      ]],
      ['What the Supreme Court decided', [
        'The Supreme Court reversed the Tenth Circuit, ruling that states may enforce requirements binding presidential electors to their pledged candidates.',
        "The ruling followed the Court's reasoning in the companion case Chiafalo v. Washington.",
      ]],
      ['Why it matters', [
        'This was a constitutional victory for Colorado, not a defeat.',
        'The decision affirmed substantial state authority over presidential electors and reinforced the ability of states to require electors to follow their pledges.',
        "It belongs in a credible Colorado litigation tracker precisely because the state's record includes victories as well as losses.",
      ]],
    ],
    source: 'Primary source: U.S. Supreme Court opinion, Colorado Department of State v. Baca, No. 19-518 (2020)',
  },
  {
    n: 4, id: '303-creative-llc-v-elenis', name: '303 Creative LLC v. Elenis', year: '2023',
    outcome: 'Colorado lost, 6–3', chip: 'loss',
    vote: [6, 3], voteNote: '6–3 against Colorado',
    meta: [
      ['Constitutional issue', 'First Amendment, compelled speech'],
      ['Decision', 'June 30, 2023'],
      ['Documented state fee settlement', 'More than $1.5 million'],
    ],
    sections: [
      ['What happened', [
        'Colorado graphic designer Lorie Smith wanted to expand her business to create custom wedding websites.',
        'Smith objected to creating websites expressing messages celebrating same-sex marriage because those messages conflicted with her religious convictions.',
        'She maintained that she would serve customers regardless of sexual orientation but would not create expressive content communicating messages she rejected.',
        'Colorado argued that its public-accommodations law prohibited the refusal.',
      ]],
      ['What the Supreme Court decided', [
        "The Supreme Court ruled 6–3 in Smith's favor.",
        "Justice Neil Gorsuch's majority opinion held that Colorado could not use its public-accommodations law to compel an individual to create expressive content contrary to her beliefs.",
        'The decision strengthened constitutional protections against compelled expression, including expression produced as part of a commercial service.',
      ]],
      ['What it cost taxpayers', [
        "In 2024, Colorado agreed to pay more than $1.5 million in attorneys' fees to resolve the litigation.",
        "That figure does not include the state's own legal expenses incurred during the years of litigation.",
      ]],
      ['Why it matters', [
        'The ruling confirmed a fundamental constitutional distinction between regulating commercial conduct and compelling protected expression.',
        "Government may enforce lawful public-accommodations requirements. It may not simply command an artist to create speech expressing the government's preferred position.",
        'Colorado defended that attempted application of its law for years, lost before the Supreme Court, and incurred a seven-figure fee obligation.',
        'The taxpayers, naturally, received the invoice.',
      ]],
    ],
    source: 'Primary source: U.S. Supreme Court opinion, 303 Creative LLC v. Elenis (2023) · Financial documentation: Colorado Public Radio, October 1, 2024',
  },
];

SCOTUS_CASES.push(
  {
    n: 5, id: 'trump-v-anderson', name: 'Trump v. Anderson', year: '2024',
    outcome: 'Colorado Supreme Court reversed, 9–0', chip: 'loss',
    vote: [9, 0], voteNote: '9–0 — Colorado reversed',
    meta: [
      ['Constitutional issue', 'Fourteenth Amendment, Section 3; presidential ballot eligibility'],
      ['Decision', 'March 4, 2024'],
    ],
    sections: [
      ['What happened', [
        "A group of Colorado voters challenged Donald Trump's eligibility to appear on the state's 2024 Republican presidential primary ballot.",
        'They argued that Section 3 of the Fourteenth Amendment disqualified him from holding office because of his conduct surrounding January 6, 2021.',
        'The Colorado Supreme Court agreed and ordered Trump excluded from the primary ballot.',
        'Trump appealed to the United States Supreme Court.',
      ]],
      ['What the Supreme Court decided', [
        "The Supreme Court unanimously reversed Colorado's judgment.",
        'The justices concluded that states lack authority to enforce Section 3 of the Fourteenth Amendment against candidates for federal office in the manner Colorado attempted.',
        "Although the justices disagreed on some aspects of the majority's broader reasoning, all nine agreed that Colorado's decision could not stand.",
      ]],
      ['Why it matters', [
        "A state's highest court attempted to remove a leading presidential candidate from its primary ballot. The United States Supreme Court unanimously reversed the decision.",
        "The case was initiated by private voters, not by Colorado's attorney general. It should therefore be identified as a reversal of the Colorado Supreme Court, rather than counted as an unsuccessful lawsuit personally initiated by state officials.",
        "Nevertheless, the constitutional significance was substantial. The Court imposed a limit on an individual state's authority to determine presidential eligibility under Section 3.",
      ]],
    ],
    source: 'Primary source: U.S. Supreme Court opinion, Trump v. Anderson, 601 U.S. 100 (2024)',
  },
  {
    n: 6, id: 'chiles-v-salazar', name: 'Chiles v. Salazar', year: '2026',
    outcome: "Colorado's legal position rejected, 8–1; case remanded", chip: 'loss',
    vote: [8, 1], voteNote: '8–1 against Colorado',
    meta: [
      ['Constitutional issue', 'First Amendment, viewpoint discrimination'],
      ['Decision', 'March 31, 2026'],
    ],
    sections: [
      ['What happened', [
        'Colorado enacted a law in 2019 prohibiting licensed mental-health professionals from providing conversion therapy to minors.',
        'Licensed counselor Kaley Chiles challenged the law as applied to voluntary, talk-only counseling.',
        'She argued that the statute restricted conversations involving clients who wanted help addressing unwanted sexual attractions or conflicts between their gender identity and biological sex, while permitting counseling affirming other outcomes.',
        'Colorado defended the law as a regulation of professional conduct intended to protect minors.',
      ]],
      ['What the Supreme Court decided', [
        "The Supreme Court ruled 8–1 that the statute, as applied to Chiles' talk therapy, regulated speech according to viewpoint and that the lower courts had failed to apply sufficiently rigorous First Amendment scrutiny.",
        "Justice Gorsuch's majority opinion rejected the idea that speech loses ordinary constitutional protection simply because it occurs within a licensed professional relationship.",
        'The Court returned the case for further proceedings.',
        "It did not categorically invalidate every provision or application of Colorado's conversion-therapy restrictions.",
      ]],
      ['Why it matters', [
        'This ruling addressed a recurring constitutional problem: government cannot avoid scrutiny of viewpoint-based speech restrictions merely by describing the speech as professional conduct.',
        "Colorado's attorney general's office defended the law before the Supreme Court, and eight justices rejected the lower courts' treatment of the constitutional issue.",
        "The state's authority to regulate professional conduct remains substantial. Its authority to dictate permitted viewpoints in protected conversations is constitutionally constrained.",
      ]],
    ],
    source: 'Primary source: U.S. Supreme Court opinion, Chiles v. Salazar, No. 24-539 (2026)',
  },
  {
    n: 7, id: 'st-mary-catholic-parish-v-roy', name: 'St. Mary Catholic Parish v. Roy', year: '2026',
    outcome: 'Awaiting Supreme Court decision', chip: 'pending',
    vote: null, voteNote: 'Argued November 3, 2026 — decision pending',
    meta: [
      ['Constitutional issue', 'First Amendment, religious exercise and public benefits'],
      ['Supreme Court argument', 'November 3, 2026'],
      ['Docket', 'No. 25-581'],
    ],
    sections: [
      ['What happened', [
        "Colorado's Universal Preschool program provides public funding that families may use at participating preschools, including religious institutions.",
        "Catholic preschools associated with the Archdiocese of Denver challenged the program's equal-opportunity enrollment requirements.",
        'The schools argued that Colorado\'s rules effectively excluded them because their admissions practices require families to support Catholic teachings, including beliefs concerning marriage, sexuality, and gender.',
        'Colorado maintained that its nondiscrimination requirements applied to religious and secular providers alike.',
      ]],
      ['What the courts have decided', [
        "The Tenth Circuit ruled in Colorado's favor in September 2025, rejecting the Catholic schools' principal constitutional challenges to the participation requirements.",
        'The United States Supreme Court granted review in April 2026.',
        "On November 3, several justices questioned whether Colorado's conditions effectively excluded certain religious schools from a generally available public benefit. Justice Samuel Alito raised the state's history of First Amendment disputes, including Masterpiece Cakeshop, 303 Creative, and Chiles.",
        'The Supreme Court has not yet issued a decision.',
      ]],
      ['Why it matters', [
        'The Court has previously ruled in Trinity Lutheran, Espinoza, and Carson that states cannot exclude religious institutions from certain generally available public benefits merely because of religious status or religious use.',
        'Colorado argues that its preschool enrollment requirements are neutral conditions governing participation, rather than religious exclusions.',
        'The Catholic schools argue that the state is accomplishing indirectly what earlier Supreme Court decisions prohibited directly.',
        'The outcome could affect how states structure public-benefit programs involving religious schools nationwide.',
        'Current status as of November 23, 2026: Awaiting decision.',
      ]],
    ],
    source: 'Primary sources: U.S. Supreme Court docket, No. 25-581 · Official oral argument transcript, November 3, 2026 · Tenth Circuit opinion, September 30, 2025',
  }
);

const FEDERAL_CASES = [
  {
    n: 8, id: 'coalition-for-secular-government-v-williams', name: 'Coalition for Secular Government v. Williams', year: '2016',
    outcome: "Colorado's disclosure rules held unconstitutional as applied to the organization", chip: 'loss',
    meta: [
      ['Court', 'U.S. Court of Appeals for the Tenth Circuit'],
      ['Documented state fee settlement', '$220,000'],
    ],
    sections: [
      ['What happened', [
        'A small secular advocacy organization sought to publish political commentary concerning a Colorado ballot measure.',
        "The organization expected to raise only a few thousand dollars, yet Colorado's campaign-finance rules threatened to subject it to registration and disclosure obligations intended for political committees.",
        'The organization challenged those requirements under the First Amendment.',
      ]],
      ['What the court decided', [
        "In March 2016, the Tenth Circuit affirmed the lower court's ruling protecting the organization from the disclosure requirements as applied to its circumstances.",
        'Colorado subsequently amended the law to create alternative requirements for small-scale issue committees.',
        "The state also paid $220,000 to resolve the organization's attorneys' fees.",
      ]],
      ['Why it matters', [
        'The First Amendment protects political participation by small organizations, not merely well-financed campaigns.',
        'The decision illustrated how government regulation can impose disproportionate burdens on ordinary political advocacy.',
        'It also provides another example of constitutional litigation producing an identifiable financial obligation for taxpayers.',
      ]],
    ],
    source: 'Primary source: Tenth Circuit opinion, March 2, 2016 · Financial documentation: Institute for Free Speech, settlement announcement',
  },
  {
    n: 9, id: 'bella-health-and-wellness-v-weiser', name: 'Bella Health and Wellness v. Weiser', year: '2025',
    outcome: "Permanent injunction protecting plaintiffs' religious exercise", chip: 'loss',
    meta: [
      ['Court', 'U.S. District Court for the District of Colorado'],
      ['Decision', 'August 1, 2025'],
      ['Documented state fee settlement', '$6.1 million'],
    ],
    sections: [
      ['What happened', [
        'Colorado enacted Senate Bill 23-190, restricting the provision of medication abortion reversal and addressing deceptive advertising by pregnancy centers.',
        'Bella Health and Wellness, a Catholic healthcare clinic, and a nurse practitioner challenged restrictions involving progesterone treatment for patients seeking to continue their pregnancies after beginning a medication abortion.',
        'Major medical organizations maintain that evidence supporting abortion-pill reversal is inadequate.',
        "The plaintiffs nevertheless argued that Colorado's restrictions unlawfully burdened their religious exercise.",
      ]],
      ['What the federal court decided', [
        "U.S. District Judge Daniel Domenico concluded that Colorado's restrictions violated the plaintiffs' rights under the First Amendment's Free Exercise Clause.",
        "The court identified problems with the state's treatment of progesterone in different medical circumstances and its failure to justify the particular burden imposed on the plaintiffs.",
        'The ruling permanently prohibited enforcement against the successful plaintiffs and those acting in concert with them. It did not invalidate the entire statute in every possible application.',
      ]],
      ['What it cost taxpayers', [
        'Colorado agreed to pay:',
        '$5.4 million to the Becket Fund for Religious Liberty.',
        '$700,000 to Alliance Defending Freedom.',
        'Total: $6.1 million.',
        'The agreements resolved the fee disputes after the permanent injunction.',
      ]],
      ['Why it matters', [
        'A state may regulate medical treatment to protect patients, but those regulations remain subject to constitutional requirements.',
        'In this case, the federal court determined that Colorado had violated religious-exercise protections, and the litigation produced a substantial fee settlement.',
        "The state's stated policy goals did not exempt its chosen enforcement mechanism from constitutional review.",
      ]],
    ],
    source: 'Official Colorado legislative case summary: Colorado General Assembly, Cases of Note · Financial documentation: The Colorado Sun, January 19, 2026',
  },
  {
    n: 10, id: 'darren-patterson-christian-academy-v-roy', name: 'Darren Patterson Christian Academy v. Roy', year: '2023–2026',
    outcome: 'District court ruled for the school; state appeal paused', chip: 'mixed',
    meta: [
      ['Court', 'U.S. District Court for the District of Colorado / Tenth Circuit'],
      ['District court decision', 'February 24, 2025'],
    ],
    sections: [
      ['What happened', [
        "Darren Patterson Christian Academy, a private Christian preschool in Buena Vista, challenged Colorado's Universal Preschool requirements.",
        "The academy maintained that its religious beliefs informed its admissions and employment practices and that the state's nondiscrimination requirements interfered with those practices.",
        'The school sought protection against exclusion from the publicly funded program.',
      ]],
      ['What the court decided', [
        "In February 2025, the federal district court entered summary judgment protecting the academy's participation in the program.",
        'The court permanently enjoined state officials from expelling, punishing, withholding funding from, or otherwise disciplining the academy because of the religious policies described in its complaint.',
        'Colorado appealed to the Tenth Circuit.',
        'In February 2026, the appellate proceedings were paused while the Supreme Court considered the related St. Mary Catholic Parish case.',
      ]],
      ['Why it matters', [
        "This case illustrates the division among federal courts over Colorado's preschool requirements.",
        "While the district court protected Darren Patterson Christian Academy's participation, the Tenth Circuit upheld Colorado's position in the related St. Mary litigation.",
        "The Supreme Court's forthcoming decision could clarify the constitutional rules applicable to both disputes.",
      ]],
    ],
    source: 'Primary source: Federal district court opinion, February 24, 2025 · Case history: Darren Patterson Christian Academy v. Roy',
  },
  {
    n: 11, id: 'netchoice-v-weiser', name: 'NetChoice v. Weiser', year: '2025–2026',
    outcome: 'Preliminary injunction against Colorado; appellate proceedings', chip: 'mixed',
    meta: [
      ['Court', 'U.S. District Court for the District of Colorado / Tenth Circuit'],
      ['Injunction issued', 'November 6, 2025'],
    ],
    sections: [
      ['What happened', [
        'Colorado enacted House Bill 24-1136, which included requirements for social-media platforms to provide specified disclosures to minors about potential mental-health effects associated with social-media use.',
        'Technology-industry organization NetChoice challenged the disclosure mandate.',
        'NetChoice argued that Colorado was compelling private platforms to communicate government-prescribed messages in violation of the First Amendment.',
        "Attorney General Phil Weiser defended the provision as an appropriate measure intended to inform minors about risks associated with social-media use.",
      ]],
      ['What the federal court decided', [
        'U.S. District Judge William Martínez granted NetChoice a preliminary injunction on November 6, 2025.',
        'The court concluded that NetChoice was substantially likely to succeed on its compelled-speech claim.',
        "Although the judge recognized Colorado's interest in protecting young people's health, he determined that the state had less restrictive options available than requiring private platforms to deliver the government's message.",
        'The injunction blocked enforcement of the challenged provision while litigation continued.',
      ]],
      ['Why it matters', [
        'This case involves a different kind of compelled speech from 303 Creative, but the underlying constitutional concern is related.',
        'The state sought to require private organizations to communicate a government-prescribed message. A federal judge concluded that the requirement was likely to violate the First Amendment.',
        'Current status: Preliminary injunction issued; litigation not finally resolved.',
      ]],
    ],
    source: 'Primary source: Federal court injunction, November 6, 2025 · Appeal docket: NetChoice v. Weiser, Tenth Circuit No. 25-1456',
  },
  {
    n: 12, id: 'hb25-1312-challenges', name: "Challenges to Colorado's HB25-1312", year: '2025–2026',
    outcome: 'Multiple First Amendment cases pending', chip: 'pending',
    meta: [
      ['Courts', 'U.S. District Court for the District of Colorado / Tenth Circuit'],
      ['Most recent major development', 'November 16, 2026 appellate arguments'],
    ],
    sections: [
      ['What happened', [
        'In May 2025, Colorado enacted House Bill 25-1312, the Kelly Loving Act.',
        "Among other provisions, the legislation amended Colorado's antidiscrimination framework to include a person's chosen name and how that person chooses to be addressed within the statutory definition of gender expression.",
        'Several plaintiffs challenged portions of the law, arguing that the amended requirements could compel them to use language inconsistent with their beliefs concerning biological sex and gender identity.',
        'The challengers include physicians, businesses, advocacy organizations, and a Christian bookstore.',
      ]],
      ['What the courts have decided', [
        'In March 2026, the federal district court denied requests for preliminary injunctions.',
        'In September, U.S. District Judge Regina Rodriguez allowed several plaintiffs\' constitutional claims to proceed while dismissing others for lack of standing.',
        'That ruling addressed whether the plaintiffs could maintain their lawsuits, not whether HB25-1312 was unconstitutional.',
        'On November 16, the Tenth Circuit heard oral arguments involving appeals from the denial of preliminary injunctions.',
        'The district-court proceedings have been stayed while related appellate questions are resolved.',
      ]],
      ['Why it matters', [
        'The lawsuits raise another significant compelled-speech question: Can Colorado enforce antidiscrimination requirements in ways that oblige private parties to use particular language concerning sex and gender identity?',
        'The plaintiffs argue that the law reaches constitutionally protected speech. Colorado disputes their claims and has defended the legislation\'s application.',
        'The constitutional merits remain unresolved.',
        'Current status as of November 23, 2026: Pending. No final ruling that the challenged provisions are unconstitutional.',
      ]],
    ],
    source: 'Primary sources: Federal court order concerning standing, September 25, 2026 · Federal district court stay order · Reporting on November 16 Tenth Circuit arguments',
  },
];

const RELATED_CASES = [
  {
    name: 'Masterpiece Cakeshop v. Scardina', year: '2024',
    meta: [['Court', 'Colorado Supreme Court'], ['Outcome', 'Case dismissed on procedural grounds']],
    paras: [
      "Autumn Scardina sought a cake with pink and blue coloring to celebrate her gender transition. Jack Phillips declined after learning the requested cake's significance.",
      'The resulting discrimination dispute eventually reached the Colorado Supreme Court.',
      'In October 2024, the court dismissed the case because Scardina had not followed the procedural requirements governing the route from administrative proceedings to a civil lawsuit.',
      "The court did not decide whether the First Amendment protected Phillips' refusal to create the cake.",
    ],
    source: 'Source: Colorado Supreme Court opinion, In re Masterpiece Cakeshop, 2024 CO 67',
  },
  {
    name: 'Lance v. Coffman', year: '2007',
    meta: [['Court', 'U.S. Supreme Court'], ['Outcome', 'Dismissed for lack of standing']],
    paras: [
      'The case concerned Colorado congressional redistricting and whether the state legislature could adopt a new congressional map after an earlier map had already been established.',
      'The Supreme Court concluded that the plaintiffs lacked standing to pursue their federal Elections Clause claim.',
      'It did not resolve the underlying constitutional question on its merits.',
    ],
    source: 'Source: U.S. Supreme Court opinion, Lance v. Coffman, 549 U.S. 437 (2007)',
  },
  {
    name: "In re Bella Boe v. Children's Hospital Colorado", year: '2026',
    meta: [['Court', 'Colorado Supreme Court'], ['Decision', 'May 18, 2026'], ['Outcome', 'Patients obtained preliminary injunctive relief']],
    paras: [
      "Four transgender minors challenged Children's Hospital Colorado's suspension of certain gender-affirming treatments.",
      'The hospital had acted amid federal policy pressure and concerns about potential financial consequences.',
      'The Colorado Supreme Court concluded that the lower court had erred in its preliminary-injunction analysis and directed relief preserving access to the disputed care while the case continued.',
      "This litigation is relevant to Colorado civil-rights law and transgender medical treatment, but it should not be counted as a federal constitutional defeat for Colorado's government. The defendant was a hospital, and the decision came from the state's highest court.",
    ],
    source: 'Source: Colorado Supreme Court opinion, In re Boe, 2026 CO 32',
  },
];

const COST_ROWS = [
  ['Bella Health and Wellness v. Weiser', 6100000, '$6,100,000'],
  ['303 Creative LLC v. Elenis', 1500000, 'More than $1,500,000'],
  ['Coalition for Secular Government v. Williams', 220000, '$220,000'],
];

const COST_INTRO = [
  'Federal constitutional litigation can become expensive even before a final judgment is entered. States incur costs for attorneys, legal research, discovery, appeals, administrative preparation, and compliance with court orders.',
  'When a successful civil-rights plaintiff qualifies for an attorneys\' fee award under federal law, the state may also become responsible for substantial opposing legal fees.',
  'Three Colorado cases have produced documented fee settlements.',
];

const COST_OUTRO = [
  'These are confirmed settlement amounts, not estimates of total government litigation spending.',
  "The calculation does not include Colorado's internal legal staffing costs, any outside counsel hired by the state, or the unresolved financial consequences of other pending cases.",
  "The confirmed figure therefore represents only a documented portion of the broader financial burden associated with Colorado's constitutional litigation.",
  'The state has a responsibility to defend lawful legislation, but lawmakers and executive officials also have a responsibility to consider constitutional risks before taxpayers are committed to years of litigation.',
  'A law with a modest projected administrative cost may ultimately expose the state to substantial legal expenses if a court finds that its enforcement violates constitutional rights.',
];

const THEMES = [
  {
    title: 'Religious liberty versus government regulation',
    cases: 'Masterpiece Cakeshop · Bella Health · St. Mary Catholic Parish · Darren Patterson Christian Academy',
    paras: [
      'Masterpiece Cakeshop, Bella Health, St. Mary Catholic Parish, and Darren Patterson Christian Academy all involve conflicts between state requirements and religious exercise.',
      'The central question is how far Colorado may regulate religious institutions or individuals before its actions violate the First Amendment.',
    ],
  },
  {
    title: 'Compelled speech and viewpoint discrimination',
    cases: '303 Creative · Chiles · NetChoice · HB25-1312 challenges',
    paras: [
      '303 Creative, Chiles, NetChoice, and the HB25-1312 challenges involve restrictions or mandates affecting expression.',
      'These cases ask whether government may require particular messages, forbid certain viewpoints, or attach regulatory consequences to protected speech.',
    ],
  },
  {
    title: 'Elections and constitutional authority',
    cases: 'Romer · Trump v. Anderson · Baca · Lance v. Coffman',
    paras: [
      "Romer, Trump v. Anderson, Colorado Department of State v. Baca, and Lance v. Coffman illustrate disputes involving voting, equal protection, electoral procedures, and the constitutional limits of state authority.",
      "Their outcomes differ considerably, but they demonstrate that Colorado's election laws and judicial decisions remain subject to federal constitutional review.",
    ],
  },
];

const SCRUTINY = [
  "The constitutional problem isn't that Colorado has strong political opinions. Every government makes policy choices, and every state must occasionally defend those choices in court.",
  'The concern arises when officials repeatedly pursue contested policies whose enforcement interferes with fundamental constitutional protections.',
  "Colorado's recent First Amendment litigation shows the potential consequences.",
  "A state agency treated a Christian baker's religious objections with unconstitutional hostility. Colorado attempted to compel expressive website content. Its counseling restrictions drew an 8–1 Supreme Court reversal and remand. A federal court permanently restrained enforcement of restrictions burdening religious healthcare providers. Other constitutional challenges continue moving through the courts.",
  "Each case involves distinct laws and legal standards. But together they raise a serious question about the state's approach to constitutional restraint.",
  "Are Colorado officials adequately considering the rights of people who disagree with the government's preferred policies before those disputes become expensive lawsuits?",
  'The question matters whether the affected citizen is a Christian business owner, a secular political activist, a religious school, or someone challenging election procedures.',
  'Constitutional rights do not disappear when elected officials believe they are pursuing a worthy objective.',
  'Nor should taxpayer-funded litigation become a routine substitute for careful constitutional review during the legislative process.',
  "Colorado residents deserve to know which laws the courts have rejected, which remain under challenge, which the state has successfully defended, and how much those disputes are costing them.",
  "That's the purpose of this tracker.",
];

const MONITOR = [
  ['St. Mary Catholic Parish v. Roy', 'Awaiting a Supreme Court ruling following November 3 arguments.'],
  ['Chiles v. Salazar', 'Lower-court proceedings following the March 2026 Supreme Court reversal.'],
  ['Darren Patterson Christian Academy v. Roy', 'Appellate proceedings dependent on developments in St. Mary.'],
  ['NetChoice v. Weiser', 'Tenth Circuit appeal following the November 2025 preliminary injunction.'],
  ['HB25-1312 challenges', 'Awaiting further appellate action following November 16 arguments.'],
  ["The Ledger's CORA requests to the Attorney General", "Awaiting the Department of Law's response — and any cost estimate — on the November 23, 2026 requests for the state's own litigation-cost records in the nine lost cases."],
];

const SOURCE_GROUPS = [
  ['U.S. Supreme Court cases', [
    ['Romer v. Evans (1996) — U.S. Supreme Court opinion', 'https://www.law.cornell.edu/supremecourt/text/517/620'],
    ['Masterpiece Cakeshop v. Colorado Civil Rights Commission (2018) — U.S. Supreme Court opinion', 'https://www.law.cornell.edu/supremecourt/text/16-111'],
    ['Colorado Department of State v. Baca (2020) — U.S. Supreme Court opinion', 'https://supreme.justia.com/cases/federal/us/591/19-518/'],
    ['303 Creative LLC v. Elenis (2023) — U.S. Supreme Court opinion', 'https://www.law.cornell.edu/supremecourt/text/21-476'],
    ['303 Creative legal fee settlement (2024) — Colorado Public Radio', 'https://www.cpr.org/2024/10/01/colorado-pays-1-5-million-to-christian-graphic-artist-gay-rights-case/'],
    ['Trump v. Anderson (2024) — U.S. Supreme Court opinion', 'https://www.law.cornell.edu/supremecourt/text/23-719'],
    ['Chiles v. Salazar (2026) — U.S. Supreme Court opinion', 'https://www.law.cornell.edu/supremecourt/text/24-539'],
    ['St. Mary Catholic Parish v. Roy (2026) — Official Supreme Court docket, No. 25-581', 'https://www.supremecourt.gov/docket/docketfiles/html/public/25-581.html'],
    ['St. Mary Catholic Parish v. Roy (2026) — Official Supreme Court oral argument transcript, November 3, 2026', 'https://www.supremecourt.gov/oral_arguments/argument_transcripts/2026/25-581_6j36.pdf'],
    ['St. Mary Catholic Parish v. Roy (2025) — Tenth Circuit Court of Appeals decision', 'https://law.justia.com/cases/federal/appellate-courts/ca10/24-1267/24-1267-2025-09-30.html'],
  ]],
  ['Federal district and appellate court cases', [
    ['Coalition for Secular Government v. Williams (2016) — Tenth Circuit Court of Appeals opinion', 'https://law.justia.com/cases/federal/appellate-courts/ca10/14-1469/14-1469-2016-03-02.html'],
    ["Coalition for Secular Government settlement — Institute for Free Speech, $220,000 attorneys' fee agreement", 'https://www.ifs.org/news/colorado-closes-free-speech-case-changes-law-pays-220k-in-attorneys-fees/'],
    ['Bella Health and Wellness v. Weiser (2025) — Colorado General Assembly, Cases of Note', 'https://content.leg.colorado.gov/agencies/office-legislative-legal-services/cases-note'],
    ['Bella Health and Wellness settlement (2026) — The Colorado Sun, $6.1 million settlement', 'https://coloradosun.com/2026/01/19/abortion-pill-reversal-lawsuit-settlement/'],
    ['Darren Patterson Christian Academy v. Roy (2025) — Federal district court decision', 'https://caselaw.findlaw.com/court/us-dis-crt-d-col/117037791.html'],
    ['Darren Patterson Christian Academy v. Roy — Alliance Defending Freedom, case history and filings', 'https://adflegal.org/case/darren-patterson-christian-academy-v-roy/'],
    ['NetChoice v. Weiser (2025) — Federal district court preliminary injunction', 'https://law.justia.com/cases/federal/district-courts/colorado/codce/1%3A2025cv02538/246452/31/'],
    ['NetChoice v. Weiser — Tenth Circuit appeal docket, No. 25-1456', 'https://dockets.justia.com/docket/circuit-courts/ca10/25-1456'],
    ['HB25-1312 First Amendment challenges (2026) — Federal district court order concerning standing', 'https://docs.justia.com/cases/federal/district-courts/colorado/codce/1:2025cv01668/244323/128'],
    ['HB25-1312 First Amendment challenges (2026) — Federal district court stay order', 'https://docs.justia.com/cases/federal/district-courts/colorado/codce/1:2025cv01572/244089/143'],
    ['HB25-1312 Tenth Circuit hearing (November 16, 2026) — Rocky Mountain Voice reporting', 'https://rockymountainvoice.com/2026/11/16/free-speech-fight-10th-circuit-enforcement-threat/'],
  ]],
  ['Additional Colorado constitutional cases', [
    ['Masterpiece Cakeshop v. Scardina (2024) — Colorado Supreme Court opinion', 'https://law.justia.com/cases/colorado/supreme-court/2024/23sc116.html'],
    ['Lance v. Coffman (2007) — U.S. Supreme Court opinion', 'https://supreme.justia.com/cases/federal/us/549/437/'],
    ["In re Bella Boe v. Children's Hospital Colorado (2026) — Colorado Supreme Court opinion", 'https://law.justia.com/cases/colorado/supreme-court/2026/26sa66.html'],
  ]],
];

function chip(kind, text, esc) {
  return '<span class="trk-chip trk-chip-' + kind + '">' + esc(text) + '</span>';
}

function voteBar(c, esc) {
  if (!c.vote) {
    // Pending: nine hollow gold dots mirroring the decided cards'
    // justice dots, so the empty row reads as "not yet voted."
    let dots = '';
    for (let i = 0; i < 9; i++) {
      dots += '<span class="trk-dot-vote trk-dot-pending" style="--d:' + i + '"></span>';
    }
    return (
      '<div class="trk-vote trk-vote-pending"><span class="trk-vote-score trk-score-pending">Pending</span>' +
      '<span class="trk-vote-dots" aria-hidden="true">' + dots + '</span>' +
      '<span class="trk-vote-note">' + esc(c.voteNote) + '</span></div>'
    );
  }
  const total = c.vote[0] + c.vote[1];
  let dots = '';
  for (let i = 0; i < total; i++) {
    dots +=
      '<span class="trk-dot-vote' +
      (i < c.vote[0] ? ' trk-dot-majority trk-dot-' + c.chip : ' trk-dot-minority') +
      '" style="--d:' + i + '"></span>';
  }
  return (
    '<div class="trk-vote"><span class="trk-vote-score trk-score-' + c.chip + '">' +
    c.vote[0] + '–' + c.vote[1] + '</span>' +
    '<span class="trk-vote-dots" aria-hidden="true">' + dots + '</span>' +
    '<span class="trk-vote-note">' + esc(c.voteNote) + '</span></div>'
  );
}

/**
 * Paragraph grouping (owner order, 2026-11-23): the owner's text
 * arrives as many one-sentence paragraphs; group consecutive
 * short paragraphs into longer ones — sentences kept verbatim and
 * in order — so the page reads as developed prose. A paragraph
 * that already runs three sentences or more stands on its own,
 * and no group exceeds five sentences.
 */
function sentenceCount(t) {
  const m = String(t).match(/[.!?]+(?=["')\]]?(?:\s|$))/g);
  return m ? m.length : 0;
}
function groupParas(list) {
  const out = [];
  let buf = '';
  let bufSentences = 0;
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
      bufSentences = 0;
    }
  };
  const items = list || [];
  for (let idx = 0; idx < items.length; idx++) {
    const p = items[idx];
    const s = sentenceCount(p);
    if (s >= 3) {
      flush();
      out.push(p);
      continue;
    }
    if (buf && bufSentences + s > 5) flush();
    buf = buf ? buf + ' ' + p : p;
    bufSentences += s;
    // Flush at three sentences — unless the only paragraph left
    // is a lone single sentence, which then joins this group
    // instead of standing alone as the section's last paragraph.
    const nextIsLoneShort =
      idx === items.length - 2 && sentenceCount(items[idx + 1]) <= 1;
    if (bufSentences >= 3 && !nextIsLoneShort) flush();
  }
  flush();
  return out;
}

/**
 * Split off a text's first sentence, guarding the abbreviations
 * that pepper case prose (U.S., v., No., initials) so the split
 * never lands mid-citation.
 */
const SENTENCE_ABBREV = new Set([
  'U.S', 'U.S.C', 'D.C', 'v', 'No', 'St', 'Mt', 'Dr', 'Mr', 'Mrs',
  'Ms', 'Jr', 'Sr', 'e.g', 'i.e',
]);
function splitFirstSentence(text) {
  const re = /[.!?]+(?=["')\]]?(?:\s|$))/g;
  let m;
  while ((m = re.exec(text))) {
    const word = (text.slice(0, m.index).match(/([A-Za-z][A-Za-z.]*)$/) || [])[1] || '';
    if (SENTENCE_ABBREV.has(word) || /^[A-Z]$/.test(word)) continue;
    return [text.slice(0, m.index + m[0].length), text.slice(m.index + m[0].length)];
  }
  return [text, ''];
}

function caseCard(c, esc, opts) {
  const o = opts || {};
  const court = o.court || 'scotus';
  const displayN = o.n || c.n;
  const meta =
    '<dl class="trk-meta">' +
    c.meta.map((m) => '<div><dt>' + esc(m[0]) + '</dt><dd>' + esc(m[1]) + '</dd></div>').join('') +
    '</dl>';
  const sections = c.sections
    .map((s) => {
      const grouped = groupParas(s[1]);
      const rendered = grouped
        .map((p, i) => {
          // Owner orders, 2026-11-23: the first sentence of every
          // court-decided section ("What the Supreme Court decided"
          // and the federal cases' "What the court decided") runs bold.
          if (i === 0 && /^What the .* decided$/.test(s[0])) {
            const parts = splitFirstSentence(p);
            return '<p><strong>' + esc(parts[0]) + '</strong>' + esc(parts[1]) + '</p>';
          }
          return '<p>' + esc(p) + '</p>';
        })
        .join('');
      return '<h4 class="trk-subhead">' + esc(s[0]) + '</h4>' + rendered;
    })
    .join('');
  const courtMeta = c.meta.find((m) => m[0] === 'Court');
  const issueMeta = c.meta.find((m) => m[0] === 'Constitutional issue');
  const courtName = courtMeta ? courtMeta[1] : court === 'scotus' ? 'U.S. Supreme Court' : 'Federal court';
  const courtLine =
    '<p class="trk-card-court">' + esc(courtName) +
    (issueMeta ? ' <span class="trk-sep">|</span> Issue: ' + esc(issueMeta[1]) : '') +
    '</p>';
  const pillText =
    c.chip === 'pending' ? 'Pending' : c.chip === 'mixed' ? 'In litigation' : 'Decided';
  return (
    '<article class="trk-card trk-card-' + c.chip + ' trk-case-card" id="case-' + c.id + '" data-court="' + court + '" data-outcome="' + c.chip + '">' +
    '<span class="trk-tl-tag" aria-hidden="true">' + esc(c.year) + '</span>' +
    '<header class="trk-card-head"><span class="trk-card-num">' + displayN + '</span>' +
    '<h3 class="trk-card-title">' + esc(c.name) + ' <span class="trk-card-year">(' + esc(c.year) + ')</span></h3>' +
    '<span class="trk-pill trk-pill-' + c.chip + '">' + pillText + '</span></header>' +
    courtLine +
    '<div class="trk-outcome">' + chip(c.chip, c.outcome, esc) + '</div>' +
    (c.vote !== undefined ? voteBar(c, esc) : '') +
    meta + sections +
    '<p class="trk-source">' + esc(c.source) + '</p>' +
    '</article>'
  );
}

function sectionHead(kicker, title, esc) {
  return (
    '<div class="trk-section-head"><div class="trk-kicker">' + esc(kicker) + '</div>' +
    '<h2 class="trk-h2">' + esc(title) + '</h2><div class="trk-rule"></div></div>'
  );
}

function renderTrackerPage(h) {
  const { esc, layout, leaderboardAdSlot, featureDivider, absUrl, fitTitle, fitDescription } = h;
  const paras = (arr) => groupParas(arr).map((p) => '<p>' + esc(p) + '</p>').join('');

  /* At a Glance band (owner redesign, 2026-11-27): the dashboard
     strip from the owner's mockup — a label block plus the five
     headline numbers for the whole tracker — over the Supreme
     Court record bar. All figures are the tracker's own data. */
  const scoreboard =
    '<section class="trk-board" aria-label="At a glance: Colorado\'s major federal cases">' +
    '<div class="trk-glance">' +
    '<div class="trk-glance-label"><span class="trk-glance-kicker">At a Glance</span>' +
    '<span class="trk-glance-title">Colorado\'s Major Federal Cases</span></div>' +
    '<div class="trk-stat"><span class="trk-stat-num" data-count="12">12</span><span class="trk-stat-label">Total cases tracked</span></div>' +
    '<div class="trk-stat"><span class="trk-stat-num trk-num-loss" data-count="9">9</span><span class="trk-stat-label">Decided against Colorado</span></div>' +
    '<div class="trk-stat"><span class="trk-stat-num" data-count="1">1</span><span class="trk-stat-label">Colorado victory (Baca, 2020)</span></div>' +
    '<div class="trk-stat"><span class="trk-stat-num trk-num-pending" data-count="2">2</span><span class="trk-stat-label">Pending cases</span></div>' +
    '<div class="trk-stat trk-stat-cost"><span class="trk-stat-num trk-num-cost" data-count="7.82" data-decimals="2" data-prefix="$" data-suffix="M+">$7.82M+</span><span class="trk-stat-label">Documented taxpayer cost in fee settlements</span></div>' +
    '</div>' +
    '<div class="trk-rb-label">The Supreme Court record — seven cases, 1996–2026</div>' +
    '<div class="trk-recordbar" role="img" aria-label="The Supreme Court record: 5 decided against Colorado, 1 Colorado victory, 1 awaiting a decision">' +
    '<span class="trk-rb-seg trk-rb-loss" data-w="71.4" style="width:71.4%"></span>' +
    '<span class="trk-rb-seg trk-rb-win" data-w="14.3" style="width:14.3%"></span>' +
    '<span class="trk-rb-seg trk-rb-pending" data-w="14.3" style="width:14.3%"></span></div>' +
    '<div class="trk-rb-legend">' +
    '<span><i class="trk-legend-dot trk-legend-loss"></i>5 decided against Colorado</span>' +
    '<span><i class="trk-legend-dot trk-legend-win"></i>1 Colorado victory</span>' +
    '<span><i class="trk-legend-dot trk-legend-pending"></i>1 awaiting a decision</span>' +
    '</div></section>';

  /* Horizontal case timeline (owner redesign, 2026-11-27): every
     tracked case as a node on one chronological line, in the
     tracker's canonical (STATUS_ROWS) order. The filter bar above
     it drives both the timeline and the case cards below. */
  const rowById = {};
  STATUS_ROWS.forEach((r) => { rowById[r[4]] = r; });
  const NODE_LABELS = {
    'romer-v-evans': ['1996', 'Romer v. Evans'],
    'coalition-for-secular-government-v-williams': ['2016', 'Coalition v. Williams'],
    'masterpiece-cakeshop': ['2018', 'Masterpiece Cakeshop'],
    'colorado-department-of-state-v-baca': ['2020', 'Baca'],
    '303-creative-llc-v-elenis': ['2023', '303 Creative'],
    'trump-v-anderson': ['2024', 'Trump v. Anderson'],
    'darren-patterson-christian-academy-v-roy': ['2025', 'Darren Patterson'],
    'bella-health-and-wellness-v-weiser': ['2025', 'Bella Health'],
    'netchoice-v-weiser': ['2025', 'NetChoice'],
    'chiles-v-salazar': ['2026', 'Chiles v. Salazar'],
    'st-mary-catholic-parish-v-roy': ['2026', 'St. Mary'],
    'challenges-to-colorados-hb25-1312': ['2025–26', 'HB25-1312'],
  };
  const NODE_STATUS = { loss: 'Against Colorado', win: 'Colorado won', mixed: 'Mixed ruling', pending: 'Pending' };
  const timeline =
    '<div class="trk-filters" role="group" aria-label="Filter the cases">' +
    '<button type="button" class="trk-filter is-active" data-filter="all" aria-pressed="true">All Cases · 12</button>' +
    '<button type="button" class="trk-filter" data-filter="decided" aria-pressed="false">Decided · 10</button>' +
    '<button type="button" class="trk-filter" data-filter="pending" aria-pressed="false">Pending · 2</button>' +
    '<button type="button" class="trk-filter" data-filter="against" aria-pressed="false">Against Colorado · 9</button>' +
    '<button type="button" class="trk-filter" data-filter="scotus" aria-pressed="false">Supreme Court · 7</button>' +
    '<button type="button" class="trk-filter" data-filter="lower" aria-pressed="false">Lower Courts · 5</button>' +
    '<span class="trk-range-chip">Date Range: 1996 – 2026</span>' +
    '</div>' +
    '<p class="trk-showing" aria-live="polite">Showing 12 of 12 cases</p>' +
    '<div class="trk-tl-scroll"><div class="trk-tl-h">' +
    STATUS_ROWS.map((r) => {
      const lab = NODE_LABELS[r[4]] || ['', r[0]];
      const court = r[1].indexOf('Supreme Court') >= 0 ? 'scotus' : 'lower';
      return (
        '<a class="trk-node trk-node-' + r[3] + '" href="#case-' + r[4] + '" data-court="' + court + '" data-outcome="' + r[3] + '">' +
        '<span class="trk-node-year">' + esc(lab[0]) + '</span>' +
        '<span class="trk-node-dotwrap"><span class="trk-node-dot"></span></span>' +
        '<span class="trk-node-name">' + esc(lab[1]) + '</span>' +
        '<span class="trk-node-status">' + NODE_STATUS[r[3]] + '</span></a>'
      );
    }).join('') +
    '</div></div>' +
    '<aside class="trk-note"><strong>How to read this tracker:</strong> A Supreme Court reversal, a permanent injunction, and a preliminary injunction are different legal outcomes. A preliminary injunction restricts enforcement while litigation proceeds; it is not necessarily a final decision on constitutionality.</aside>';

  /* One chronological stack of case cards (owner redesign,
     2026-11-27), in STATUS_ROWS order, numbered 1–12. */
  const caseById = {};
  SCOTUS_CASES.forEach((c) => { caseById[c.id] = { c, court: 'scotus' }; });
  FEDERAL_CASES.forEach((c) => { caseById[c.id] = { c, court: 'lower' }; });
  const caseStack =
    '<div class="trk-timeline">' +
    STATUS_ROWS.map((r, i) => {
      const e = caseById[r[4]];
      return e ? caseCard(e.c, esc, { n: i + 1, court: e.court }) : '';
    }).join('') +
    '</div>';

  const costChart =
    '<div class="trk-chart">' +
    COST_ROWS.map((r) => {
      const pct = Math.max(2.5, (r[1] / 6100000) * 100);
      return (
        '<div class="trk-chart-row"><div class="trk-chart-name">' + esc(r[0]) + '</div>' +
        '<div class="trk-chart-track"><span class="trk-chart-bar" style="width:' + pct.toFixed(1) + '%"></span></div>' +
        '<div class="trk-chart-amt">' + esc(r[2]) + '</div></div>'
      );
    }).join('') +
    '<div class="trk-chart-total"><span>Combined documented obligations</span><strong>More than $7,820,000</strong></div></div>';

  const TAKEAWAYS = [
    'Nine of the twelve cases in this tracker have gone against Colorado. The state\'s only Supreme Court victory is Baca, its 2020 presidential electors case.',
    'Most of the fights are First Amendment fights — religious liberty and compelled speech run from Masterpiece Cakeshop through 303 Creative and Chiles to the pending St. Mary case.',
    'The documented settlements alone top $7.82 million, and they count only what Colorado paid the other side\'s lawyers — not the state\'s own legal bills.',
    'Two cases are still live — St. Mary at the Supreme Court and the HB25-1312 challenges — so the record, and the bill, are still growing.',
  ];
  /* CORA panel (owner order, 2026-11-27: make the Ledger's records
     request prominent): a full-width navy announcement band directly
     under the Bill section head, ahead of the cost grid. */
  const coraPanel =
    '<section class="trk-cora" aria-label="The Ledger\'s open records request to the state">' +
    '<div class="trk-cora-kicker">Colorado Open Records Act · Filed November 23, 2026</div>' +
    '<h3 class="trk-cora-title">The Ledger has asked the state for its own bill.</h3>' +
    '<p class="trk-cora-body">The figures in this tracker count only what Colorado has paid the other side\'s lawyers. They do not count what the state spent defending these cases itself — its own attorneys\' time, outside counsel, travel and administration. The Centennial Ledger has filed requests under the Colorado Open Records Act with the Attorney General\'s office for exactly those records in the lost cases in this tracker: the attorney hours recorded, outside-counsel invoices, travel reimbursements, and settlement and court-ordered fee payments.</p>' +
    '<p class="trk-cora-status"><span class="trk-watch-dot" aria-hidden="true"></span><span>Status: awaiting the Department of Law\'s response. When the state answers, this tracker will be updated with what this litigation actually cost. If the state will not produce the numbers, this page will say that too.</span></p>' +
    '</section>';

  const billSection =
    coraPanel +
    '<div class="trk-bill-grid"><div class="trk-bill-main">' +
    '<div class="trk-prose">' + paras(COST_INTRO) + '</div>' +
    costChart +
    '<div class="trk-prose">' + paras(COST_OUTRO) + '</div>' +
    '</div>' +
    '<aside class="trk-takeaways"><h3>Key Takeaways</h3><ul>' +
    TAKEAWAYS.map((t) => '<li>' + esc(t) + '</li>').join('') +
    '</ul></aside></div>';

  let n = 0;
  const sourcesHtml = SOURCE_GROUPS.map(
    (g) =>
      '<h3 class="trk-src-group">' + esc(g[0]) + '</h3><ol class="trk-sources" start="' + (n + 1) + '">' +
      g[1]
        .map((s) => {
          n++;
          return '<li><a href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + esc(s[0]) + '</a></li>';
        })
        .join('') +
      '</ol>'
  ).join('');

  /* Page interactions (2026-11-27 redesigns): count-up stats, the
     timeline/card filters, and scroll-triggered reveals and bar
     animations. Everything degrades to the fully rendered static
     page when scripts or IntersectionObserver are unavailable, and
     honors prefers-reduced-motion. */
  const trackerScript = `<script>
(function () {
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.documentElement.classList.add('trk-js');
  var counters = document.querySelectorAll('.trk-stat-num[data-count]');
  function fmt(el, v) {
    var d = parseInt(el.getAttribute('data-decimals') || '0', 10);
    return (el.getAttribute('data-prefix') || '') + v.toFixed(d) + (el.getAttribute('data-suffix') || '');
  }
  function runCount(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    if (reduce || !window.requestAnimationFrame) { el.textContent = fmt(el, target); return; }
    var t0 = null, dur = 1100;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(el, target * eased);
      if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(el, target);
    }
    requestAnimationFrame(step);
  }
  var filters = document.querySelectorAll('.trk-filter');
  var cards = document.querySelectorAll('.trk-case-card');
  var nodes = document.querySelectorAll('.trk-node');
  var showing = document.querySelector('.trk-showing');
  function matches(el, f) {
    var outcome = el.getAttribute('data-outcome');
    var court = el.getAttribute('data-court');
    return f === 'all' ||
      (f === 'decided' && outcome !== 'pending') ||
      (f === 'pending' && outcome === 'pending') ||
      (f === 'against' && (outcome === 'loss' || outcome === 'mixed')) ||
      (f === 'scotus' && court === 'scotus') ||
      (f === 'lower' && court === 'lower');
  }
  function applyFilter(f) {
    var n = 0;
    cards.forEach(function (el) {
      var show = matches(el, f);
      el.style.display = show ? '' : 'none';
      if (show) n++;
    });
    nodes.forEach(function (el) { el.classList.toggle('trk-node-off', !matches(el, f)); });
    if (showing) showing.textContent = 'Showing ' + n + ' of ' + cards.length + ' cases';
  }
  filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filters.forEach(function (b) { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
      applyFilter(btn.getAttribute('data-filter'));
    });
  });
  var bars = document.querySelectorAll('.trk-rb-seg, .trk-chart-bar');
  bars.forEach(function (b) {
    b.setAttribute('data-finalw', b.style.width);
    if (!reduce) b.style.width = '0%';
  });
  function activate(scope) {
    scope.querySelectorAll('.trk-rb-seg, .trk-chart-bar').forEach(function (b) {
      b.style.width = b.getAttribute('data-finalw');
    });
  }
  var targets = document.querySelectorAll('.trk-card, .trk-board, .trk-chart, .trk-theme, .trk-takeaways');
  if ('IntersectionObserver' in window && !reduce) {
    targets.forEach(function (el) { el.classList.add('trk-reveal'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('trk-in');
        if (en.target.classList.contains('trk-board')) { counters.forEach(runCount); activate(en.target); }
        if (en.target.classList.contains('trk-chart')) activate(en.target);
        io.unobserve(en.target);
      });
    }, { threshold: 0.12 });
    targets.forEach(function (el) { io.observe(el); });
  } else {
    counters.forEach(function (el) { el.textContent = fmt(el, parseFloat(el.getAttribute('data-count'))); });
    bars.forEach(function (b) { b.style.width = b.getAttribute('data-finalw'); });
  }
})();
</script>`;

  const body =
    leaderboardAdSlot() +
    '<div class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/section/politics">Politics</a> &rsaquo; Federal Lawsuit Tracker</div>' +
    '<div class="trk-hero-head"><div class="trk-hero-text">' +
    '<div class="trk-kicker">Special Reports · Colorado Legal Watch</div>' +
    '<div class="trk-h1-row"><h1 class="headline trk-h1">Colorado Federal Lawsuit Tracker</h1>' +
    '<p class="trk-updated">Last updated: ' + UPDATED + '</p></div>' +
    '<p class="dek trk-dek">A running record of major federal lawsuits involving Colorado, from landmark Supreme Court cases to active challenges, with case status, key issues and what they are costing taxpayers.</p>' +
    '</div>' +
    '</div>' +
    '<div class="trk-prose">' +
    '<figure class="trk-hero trk-hero-court"><img src="/images/supreme-court-engraving.webp" alt="Engraving of the United States Supreme Court building in Washington, D.C.">' +
    '<figcaption>The U.S. Supreme Court building in Washington, D.C. AI illustration.</figcaption></figure>' +
    paras(INTRO) + '</div>' +
    scoreboard +
    sectionHead('The Record', 'Case Timeline', esc) +
    '<p class="trk-lede">Key federal lawsuits involving Colorado, in chronological order. Pick a case on the line to jump to its card, or filter the record.</p>' +
    timeline +
    sectionHead('The Bill', 'What These Cases Are Costing Taxpayers', esc) +
    billSection +
    sectionHead('The Cases', 'The Cases in Chronological Order', esc) +
    '<p class="trk-lede">The following cases have not all produced final Supreme Court decisions. Some involve permanent injunctions, some preliminary injunctions, and others ongoing litigation.</p>' +
    caseStack +
    sectionHead('Also on the Record', 'Related Colorado Court Cases', esc) +
    '<p class="trk-lede">These cases involve important constitutional or civil-rights questions, but they are separated from the main federal tracker because they were decided in Colorado state courts or did not result in a federal ruling on the constitutional merits.</p>' +
    RELATED_CASES.map(
      (c) =>
        '<article class="trk-card trk-card-related"><header class="trk-card-head">' +
        '<h3 class="trk-card-title">' + esc(c.name) + ' <span class="trk-card-year">(' + esc(c.year) + ')</span></h3></header>' +
        '<dl class="trk-meta">' +
        c.meta.map((m) => '<div><dt>' + esc(m[0]) + '</dt><dd>' + esc(m[1]) + '</dd></div>').join('') +
        '</dl>' + paras(c.paras) +
        '<p class="trk-source">' + esc(c.source) + '</p></article>'
    ).join('') +
    sectionHead('The Pattern', 'The Recurring Constitutional Questions', esc) +
    '<p class="trk-lede">Colorado\'s major constitutional disputes span different administrations, political parties, and areas of law. Yet several recurring legal questions are apparent.</p>' +
    '<div class="trk-themes">' +
    THEMES.map(
      (t) =>
        '<section class="trk-theme"><h3>' + esc(t.title) + '</h3>' +
        '<p class="trk-theme-cases">' + esc(t.cases) + '</p>' + paras(t.paras) + '</section>'
    ).join('') +
    '</div>' +
    sectionHead('The Stakes', "Why Colorado's Litigation Record Deserves Public Scrutiny", esc) +
    '<div class="trk-prose">' + paras(SCRUTINY) + '</div>' +
    '<blockquote class="trk-quote">The Constitution is supposed to limit government power. Colorado taxpayers shouldn\'t have to pay millions every time the state needs reminding.</blockquote>' +
    sectionHead('About This Tracker', 'Tracker Updates and Methodology', esc) +
    '<div class="trk-method">' +
    '<p><strong>Last reviewed:</strong> ' + UPDATED + '</p>' +
    '<p>This tracker covers the most significant constitutional cases involving Colorado state laws, state officials, state agencies, and significant Colorado judicial decisions. It is not a complete inventory of every federal lawsuit involving Colorado.</p>' +
    '<h4 class="trk-subhead">Latest developments to monitor</h4><ul class="trk-monitor">' +
    MONITOR.map((m) => '<li><span class="trk-watch-dot" aria-hidden="true"></span><strong>' + esc(m[0]) + ':</strong> ' + esc(m[1]) + '</li>').join('') +
    '</ul>' +
    '<p><strong>Source standards:</strong> Final judicial opinions and official dockets take precedence over commentary. Published reporting is used for settlements and other developments not fully reflected in opinions. A pending allegation is never classified as a proven constitutional violation, and a preliminary ruling is not treated as a final judgment.</p>' +
    '<p><strong>Taxpayer-cost methodology:</strong> Only documented state payment obligations are included in the settlement total. Amounts are not assigned to pending cases without verifiable financial records.</p>' +
    '<p><strong>Editorial perspective:</strong> This tracker examines government accountability and constitutional limits from a perspective skeptical of expansive state power, while preserving the actual findings, procedural history, and outcomes of the courts.</p>' +
    '</div>' +
    '<section class="trk-sources-wrap"><h2 class="trk-h2">Sources</h2><div class="trk-rule"></div>' + sourcesHtml + '</section>' +
    trackerScript +
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';

  return layout({
    title: fitTitle('Colorado Federal Lawsuit Tracker: Colorado vs. the Constitution', 70),
    description: fitDescription(
      'Track Colorado\'s federal constitutional lawsuits: Supreme Court losses in Masterpiece, 303 Creative and Chiles, the pending St. Mary case, and $7.82M in taxpayer fee settlements.'
    ),
    path: TRACKER_PATH,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Colorado vs. the Constitution: Federal Lawsuit Tracker',
        description:
          "A running tracker of Colorado's federal constitutional litigation: what the state tried to do, what the courts decided, and what it has cost taxpayers.",
        dateModified: '2026-11-27',
        author: { '@type': 'Organization', name: h.siteName },
        publisher: { '@type': 'Organization', name: h.siteName },
        mainEntityOfPage: absUrl(TRACKER_PATH),
      },
    ],
    activeNav: 'politics',
    body,
  });
}


module.exports = { renderTrackerPage, TRACKER_PATH };
