---
name: portfolio-project-builder
description: Build honest, end-to-end data analyst / data scientist portfolio projects for the user (Abdolrahman, GitHub Mimogu) - pick a public dataset, define business questions, analyse/model, build dashboard or notebook, write README, publish to GitHub and the portfolio site. Use when they ask for a new portfolio project, project ideas, Kaggle project, or to add work to their profile/CV/LinkedIn.
---

# Portfolio project builder

## Rules (non-negotiable)
- Real public datasets (Kaggle, data.gov, World Bank, CAPMAS Egypt open data, UCI) with source + licence cited,
  OR clearly labelled synthetic data. Never present practice work as client work.
- The user does the learning: pair this with `data-science-tutor` - explain each step and let them write key parts
  when they want to learn; if they only want the project built, still explain decisions in the README.
- Credit only the user: commits as `Abdolrahman Eata <78258979+Mimogu@users.noreply.github.com>`, no Claude
  co-author lines, document metadata author "Abdolrahman Ashraf Eata" (see memory no-claude-attribution).
- QA before publishing: `anti-sycophancy`, `data:validate-data`, `ml-workflow` / `experiment-and-inference` as relevant;
  notebook runs top-to-bottom clean (`jupyter nbconvert --execute`).

## Project shape (one repo per project)
```
README.md          # problem, data source, approach, key findings with numbers, visuals, how to run, next steps
data/README.md     # where to download (don't commit big/licensed data)
notebooks/01_explore.ipynb, 02_model.ipynb
src/               # reusable cleaning/feature code
reports/figures/   # PNGs used in README/LinkedIn
dashboard/         # .pbix screenshots or Streamlit app
requirements.txt
```

## Good project ladder (analyst -> scientist)
1. Sales/retail EDA + Power BI (done-ish: Nile Mart demo).
2. Customer churn prediction (telco/bank Kaggle) - classification, PR-AUC, SHAP, retention recommendations.
3. Demand forecasting (store sales / M5 subset) - time-series CV, baselines vs model.
4. A/B test analysis (public e-commerce A/B dataset) - power, SRM, CI, decision memo.
5. Customer segmentation (RFM + k-means) with marketing actions.
6. SQL analytics case (window functions on a public DB) + Streamlit or Power BI dashboard.
7. NLP: Arabic product/app reviews sentiment (shows Arabic edge).
Prefer Egyptian/MENA angles when data exists - it differentiates the profile.

## Publish checklist
GitHub repo (public, description, topics) -> add card to `~/freelance-portfolio/websites/portfolio-site/index.html`
-> push -> LinkedIn post draft (English, facts only, user approves) -> add to Kafil/Nafezly portfolio if relevant.
