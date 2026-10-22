# Guide: use Google Sheets (budget, list, tracker, simple maths)

Use this guide when the user's goal involves a spreadsheet: a budget, a customer or stock list, a tracker, totals, or a chart. Google Sheets is a website: sheets.google.com (it opens docs.google.com/spreadsheets).

Goal state: the sheet has the data and formulas the user wanted, and it is saved (Sheets saves by itself).

## Steps
1. **Sign in.** Google Sheets needs a Google account. The user signs in themselves; never ask for a password.
2. **Start a sheet.** On the Sheets home page, press the "Blank spreadsheet" tile (a big plus sign). A new sheet opens with a grid.
3. **Name it.** Click the title at the top left that says "Untitled spreadsheet", type a name, press Enter.
4. **Type the headings.** Click the first cell (called A1, the top left of the grid) and type a heading, press Tab to move right, then Enter to go down. You cannot point at a cell because the grid is drawn on a canvas; say it in words ("the first cell at the top left, called A1").
5. **Add totals.** Give the user a formula as copyText to paste into a cell, for example `=SUM(B2:B10)` to add numbers, `=AVERAGE(B2:B10)` for an average, or `=B2*C2` to multiply two cells. Explain in one simple sentence what it does. They click the cell, paste, and press Enter.
6. **Make it look neat.** Select the headings row, then press the Bold button ("B") in the toolbar. Use "Format" in the menu bar for numbers, such as currency (the ₹ symbol is under "More formats").
7. **Chart (if wanted).** Select the numbers, press "Insert" in the menu bar, then "Chart".
8. **Share (if wanted).** Press the green "Share" button at the top right and add the person's email.
9. Done when the user has what they asked for.

## Notes
- Menu names ("File", "Edit", "View", "Insert", "Format", "Data") are along the top, under the title.
- Trust the page over this guide and set verified false for any name you are not sure about.
- For anything inside the grid, set elementId to null and describe the place in simple words.
