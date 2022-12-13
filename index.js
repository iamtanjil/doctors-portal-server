const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const nodemailer = require("nodemailer");
const port = process.env.Port || 5000;

const app = express();

//middleware

app.use(cors());
app.use(express.json());

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


const uri = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Pass}@cluster0.ty2hcly.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })

}
function sendEmail (booking){
    let transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        auth: {
          user: testAccount.user, // generated ethereal user
          pass: testAccount.pass, // generated ethereal password
        },
      });
}

async function run() {

    try {
        const appoinmentOptionsCollection = client.db("doctorsPortal").collection("appointmentOption");
        const bookingsCollection = client.db("doctorsPortal").collection("bookings");
        const usersCollection = client.db("doctorsPortal").collection("users");
        const doctorsCollection = client.db("doctorsPortal").collection("doctors");
        const paymentsCollection = client.db("doctorsPortal").collection("payments");

        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user.role !== 'admin') {
                return res.status(403).send({ message: 'forbiden access' })
            }
            next();
        };

        app.get('/appointmentoption', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appoinmentOptionsCollection.find(query).toArray();
            const bookingQuery = { appoinmentDate: date };
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlots = optionBooked.map(book => book.slot);
                const remainingSlot = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlot;
            })
            res.send(options)
        });

        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query);
            res.send(booking);
        })

        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {};
            const result = await appoinmentOptionsCollection.find(query).project({ name: 1 }).toArray();
            res.send(result)
        })

        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            const query = {
                email: email
            };
            const result = await bookingsCollection.find(query).toArray();
            res.send(result)
        })

        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            const query = {
                appoinmentDate: booking.appoinmentDate,
                treatment: booking.treatment,
                email: booking.email
            };

            const alreadyBooked = await bookingsCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You already have an appointment on ${booking.appoinmentDate}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingsCollection.insertOne(booking);
            //send booking information email 
            sendEmail(booking)
            res.send(result)
        });

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            }
            res.status(403).send({ accessToken: '' })
        })

        app.get('/users', async (req, res) => {
            const query = {};
            const result = await usersCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' })
        });

        app.put('/users/admin/:id', verifyJWT, async (req, res) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user.role !== 'admin') {
                return res.status(403).send({ message: 'forbiden access' })
            }

            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const option = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            };

            const result = await usersCollection.updateOne(filter, updatedDoc, option);
            res.send(result)
        });

        // //temporary code
        // app.get('/updateprice', async (req, res) => {
        //     const filter = {};
        //     const option = { upsert: true };
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     };
        //     const result = await appoinmentOptionsCollection.updateMany(filter, updatedDoc, option);
        //     res.send(result);
        // });

        app.get('/managedoctor', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {};
            const result = await doctorsCollection.find(query).toArray();
            res.send(result)
        });

        app.post('/adddoctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result)
        });

        app.delete('/managedoctor/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        });

        app.post('/create-payment-intent', async(req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: "usd",
                amount: amount,
                "payment_method_types": [
                    "card"
                  ],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
              });
        });

        app.post('/payments', async(req, res) => {
            const payments = req.body;
            const result = await paymentsCollection.insertOne(payments);
            const id = payments.objectId;
            const filter = {_id: ObjectId(id)};
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payments.transactionId
                }
            };
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result);
        });
    }
    finally {

    }

}
run().catch(console.dir)

app.get('/', async (req, res) => {
    res.send('Doctors Portal Server is Running')
});

app.listen(port, () => {
    console.log(`Doctors Portal Server is running on port: ${port}`)
});