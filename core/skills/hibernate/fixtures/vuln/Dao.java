import javax.persistence.EntityManager;
class Dao {
  Object f(EntityManager em, String order) {
    return em.createQuery("from User order by " + order); // EXPECT hibernate.query-concat
  }
}
