const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const app = express();
require("dotenv").config();
const port = process.env.PORT;
const cors = require("cors");
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = process.env.MONGODB_URI;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const database = client.db("startupforge");
    const startupCollection = database.collection("startups");
    const opportunityCollection = database.collection("opportunities");

    // All Startups Api
    app.get("/api/startups/:email", async (req, res) => {
      const { email } = req.params;
      const result = await startupCollection
        .find({ founderEmail: email })
        .toArray();

      res.send(result);
    });

    app.post("/api/startup", async (req, res) => {
      const {
        name,
        logoUrl,
        industry,
        description,
        fundingStage,
        founderEmail,
      } = req.body;

      const startup = {
        name,
        logoUrl,
        industry,
        description,
        fundingStage,
        founderEmail,
        createdAt: new Date(),
        status: "active",
      };

      const result = await startupCollection.insertOne(startup);
      res.send(result);
    });

    app.delete("/api/startups/:id", async (req, res) => {
      const { id } = req.params;

      const result = await startupCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    app.patch("/api/startups/:id", async (req, res) => {
      const { id } = req.params;
      const result = await startupCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body },
      );
      res.send(result);
    });

    // All Opportunities Api

    app.get("/api/opportunities/:email", async (req, res) => {
      const { email } = req.params;
      const result = await opportunityCollection.find({   founderEmail: email }).toArray();
      res.send(result);
    });

    

    app.post("/api/opportunity", async (req, res) => {
      const opportunity = req.body;
      const result = await opportunityCollection.insertOne(opportunity);
      res.send(result);
    });

    app.delete("/api/opportunities/:id", async (req, res) => {
      const { id } = req.params;

      const result = await opportunityCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });
    app.patch("/api/opportunities/:id", async (req, res) => {
      const { id } = req.params;
      const result = await opportunityCollection.updateOne(
        { _id: new ObjectId(id) },                    
        { $set: req.body },
      );
      res.send(result);
    });

    // Browse Opportunities Api
    app.get("/api/opportunities", async (req, res) => {
      const result = await opportunityCollection.find().toArray();
      res.send(result);
    });

    app.get("/api/opportunity/:id", async (req, res) => {
      const { id } = req.params;
      const result = await opportunityCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB",
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
