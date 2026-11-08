# Localization / Internationalization

Nuncio supports localization - the app's menus, messages, buttons, and more are loaded from language files based on the user's locale. This makes the app accessible to millions of people around the world and helps it blend in on your desktop!

The translation files are inherited from the Mailspring project: an initial translation in ~90 languages based on a database of human-translated email terms and technical phrases (eg: "Archive", "Send message", etc.). If you use your computer in another language and also speak English, contributing translations is a great way to impact the open source project!

## Contributing Localizations

#### Submit a Pull Request

If you have a GitHub account, you can improve the localization files directly and submit a Pull Request to [github.com/Bojanni050/nuncio](https://github.com/Bojanni050/nuncio).

You'll find the localization files in [app/lang](app/lang) named according to the "Language tag" standard. If you're not sure what language tag applies to your language, check the [ISO 639-1 lookup table](http://www.loc.gov/standards/iso639-2/php/English_list.php). To modify the file on GitHub and submit a pull request, click the "Pencil Icon" when viewing the file.

Each file contains a JSON dictionary mapping an English string to a translated string. For example:

```
{
  "%@ of %@": "%1$@ de %2$@",
  "Accept": "Aceptar",
  "Account": "Cuenta",
  "Moved to %@": "Movido a %@"
}
```

The example above shows two examples of variable substitution. Some strings display text the user provides, like a folder name. In the localized strings, placeholders (`%@`) represent this text.

If a string contains multiple placeholders, you can optionally reference the variables by index using the `%2$@` syntax. Using `2` means this placeholder should be replaced with the second placeholder in the English string. This allows you to change the order variables appear, which is important for languages like Japanese.

## Running Nuncio with a Specific Locale

It can be useful to run Nuncio with a specific locale. To do this, pass the `lang` flag at launch:

```
npm start -- --lang=de
```

## Understanding the scripts

- **format-localizations.js**

  - **Usage:** `node scripts/format-localizations.js`
  - **Description:** This script finds all uses of `localized()` in ts, tsx, js, jsx files. And include them in _en.json_. It also removes unused translations from all locales and sorts them alphabetically.

- **improve-localization.js**

  - **Usage:** `node scripts/improve-localization.js`
  - **Description:** This script compares the translations in _en.json_ and in the chosen locale.

    - **Option 1:** It will prompt you for each missing translation. (if you wish to skip a translation, simply leave blank and press Enter)

    - **Option 2:** It will set null to each missing translation, and it will be up to you to replace them directly in the corresponding json file.
