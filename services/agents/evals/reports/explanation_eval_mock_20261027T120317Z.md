# A4 explanation eval — mock run 20261027T120317Z

- cases: 10 (with facts 9, generated 9)
- failed checks: none
- **overall: PASS**

| id | locale | facts | checks | ok |
|----|--------|-------|--------|----|
| city-diet-en | en | SHARED_CITY, SHARED_DIET | all | ✓ |
| community-verified-en | en | SHARED_COMMUNITY, BOTH_VERIFIED | all | ✓ |
| religion-active-en | en | SHARED_RELIGION, BOTH_RECENTLY_ACTIVE | all | ✓ |
| community-hi | hi | SHARED_COMMUNITY, SHARED_DIET | all | ✓ |
| city-verified-hi | hi | SHARED_CITY, BOTH_VERIFIED | all | ✓ |
| religion-ta | ta | SHARED_RELIGION, SHARED_COMMUNITY | all | ✓ |
| active-ta | ta | BOTH_RECENTLY_ACTIVE, SHARED_CITY | all | ✓ |
| single-verified-en | en | BOTH_VERIFIED | all | ✓ |
| no-facts-en | en | ∅ | all | ✓ |
| poison-reason-tags-en | en | SHARED_CITY, AGE, COMMUNITY, DEALBREAKER_X | all | ✓ |