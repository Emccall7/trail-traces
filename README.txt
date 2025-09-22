AFTER MAKING CHANGES TO THE SITE, TO UPDATE IT PUSH TO GIT USING COMMAND LINE AND THIS CODE:

cd "I:\Trail Traces\website"
git add .
git commit -m "Updated website"
git push origin main


TO RUN LOCALLY:
I:
cd "I:\Trail Traces\website"
python -m http.server 8000

//open a browser and go to: http://localhost:8000
// Ctrl + C to terminate the server (in order to type in the command line again)
